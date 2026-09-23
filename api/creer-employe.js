// /api/creer-employe.js
//
// Fonction serverless Vercel : tourne cote serveur, jamais dans le
// navigateur. C'est la seule maniere sure de creer un compte de
// connexion, car ca necessite la cle secrete "service_role" de
// Supabase, qui ne doit JAMAIS apparaitre dans le code du site.
//
// IMPORTANT : cette fonction utilise la cle service_role, qui
// contourne TOUTE la securite de la base (RLS). La verification des
// droits doit donc etre faite ICI, explicitement, avant toute action.

import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const RANG = {
  administrateur: 4,
  pdg: 3,
  manager: 2,
  caissiere: 1,
  controleur: 1
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ erreur: "Methode non autorisee" });
  }

  // ---------- 1. Verifier que l'appelant est bien connecte ----------
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({ erreur: "Non authentifié" });
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);

  if (userError || !userData?.user) {
    return res.status(401).json({ erreur: "Session invalide" });
  }

  // ---------- 2. Verifier le role et le rang de l'appelant ----------
  const { data: appelantProfil, error: profilError } = await supabaseAdmin
    .from("profils")
    .select("role, actif")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profilError || !appelantProfil || !appelantProfil.actif) {
    return res.status(403).json({ erreur: "Compte non autorisé" });
  }

  const { nom, telephone, email, motDePasse, role } = req.body;

  if (!nom || !email || !motDePasse || !role) {
    return res.status(400).json({ erreur: "Champs manquants" });
  }

  if (!(role in RANG)) {
    return res.status(400).json({ erreur: "Role invalide" });
  }

  // ---------- 3. La regle de hierarchie : jamais son propre niveau ou plus ----------
  const rangAppelant = RANG[appelantProfil.role] || 0;
  const rangDemande = RANG[role];

  const estAutorise = appelantProfil.role === "administrateur" || rangAppelant > rangDemande;

  if (!estAutorise) {
    return res.status(403).json({ erreur: "Tu n'as pas le droit de créer un compte de ce niveau." });
  }

  try {
    // 4. Creer le compte de connexion (email + mot de passe)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: email,
      password: motDePasse,
      email_confirm: true
    });

    if (authError) {
      return res.status(400).json({ erreur: authError.message });
    }

    // 5. Creer le profil associe (nom, telephone, role)
    const { error: nouveauProfilError } = await supabaseAdmin
      .from("profils")
      .insert([{
        id: authData.user.id,
        nom: nom,
        telephone: telephone || null,
        role: role,
        actif: true
      }]);

    if (nouveauProfilError) {
      // Si le profil echoue, on supprime le compte de connexion cree
      // juste avant, pour ne pas laisser un compte "fantome" sans profil.
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return res.status(400).json({ erreur: nouveauProfilError.message });
    }

    // 6. Journaliser l'action
    await supabaseAdmin.from("journal_actions").insert([{
      profil_id: userData.user.id,
      action: `Création du compte "${nom}" avec le rôle ${role}`,
      details: { nouveau_compte_id: authData.user.id, role: role }
    }]);

    return res.status(200).json({ succes: true, id: authData.user.id });

  } catch (err) {
    return res.status(500).json({ erreur: err.message || "Erreur serveur" });
  }
}
