// /api/creer-employe.js
//
// Fonction serverless Vercel : tourne cote serveur, jamais dans le
// navigateur. C'est la seule maniere sure de creer un compte de
// connexion, car ca necessite la cle secrete "service_role" de
// Supabase, qui ne doit JAMAIS apparaitre dans le code du site.
//
// La cle est lue depuis les variables d'environnement Vercel
// (Project Settings > Environment Variables), jamais ecrite ici.

import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ erreur: "Methode non autorisee" });
  }

  const { nom, telephone, email, motDePasse, role } = req.body;

  if (!nom || !email || !motDePasse || !role) {
    return res.status(400).json({ erreur: "Champs manquants" });
  }

  const rolesValides = ["pdg", "administrateur", "manager", "caissiere", "controleur"];
  if (!rolesValides.includes(role)) {
    return res.status(400).json({ erreur: "Role invalide" });
  }

  try {
    // 1. Creer le compte de connexion (email + mot de passe)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: email,
      password: motDePasse,
      email_confirm: true
    });

    if (authError) {
      return res.status(400).json({ erreur: authError.message });
    }

    // 2. Creer le profil associe (nom, telephone, role)
    const { error: profilError } = await supabaseAdmin
      .from("profils")
      .insert([{
        id: authData.user.id,
        nom: nom,
        telephone: telephone || null,
        role: role,
        actif: true
      }]);

    if (profilError) {
      // Si le profil echoue, on supprime le compte de connexion cree
      // juste avant, pour ne pas laisser un compte "fantome" sans profil.
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return res.status(400).json({ erreur: profilError.message });
    }

    return res.status(200).json({ succes: true, id: authData.user.id });

  } catch (err) {
    return res.status(500).json({ erreur: err.message || "Erreur serveur" });
  }
}
