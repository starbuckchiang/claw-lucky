const SUPABASE_URL = "https://umtqpstacjdwxcvcirbl.supabase.co";
const SUPABASE_KEY = "sb_publishable_PtWhyYhKGUVxph4o80oGbg_aeZVnUyk";

if (!window.supabaseClient) {
  window.supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.localStorage,
        storageKey: "claw-lucky-auth"
      }
    }
  );

  console.log("[config] Supabase client created");
} else {
  console.log("[config] Supabase client already exists");
}
