const SUPABASE_URL = "https://umtqpstacjdwxcvcirbl.supabase.co";
const SUPABASE_KEY = "sb_publishable_PtWhyYhKGUVxph4o80oGbg_aeZVnUyk";

window.supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);
