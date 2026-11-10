import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Debug readout
console.log('--- SUPABASE DEBUG ---');
console.log('URL:', supabaseUrl);
console.log('KEY READOUT:', supabasePublishableKey ? `${supabasePublishableKey.substring(0, 12)}...` : 'UNDEFINED / MISSING');

// Standaard initialisatie (geen handmatige headers nodig)
export const supabase = createClient(supabaseUrl, supabasePublishableKey);