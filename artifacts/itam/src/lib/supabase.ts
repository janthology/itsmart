import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://wngurnuozjzzdhveegjz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InduZ3VybnVvemp6emRodmVlZ2p6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5OTEzMjksImV4cCI6MjA4OTU2NzMyOX0.4Egd_5WWeZc7yivsQre4IVrIk25igJ0rRsCbwpimyXo';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
