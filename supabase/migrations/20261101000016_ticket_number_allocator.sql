-- Locally prepared; do not blanket-push the mismatched production history.
-- The counter row serializes automatic allocation per year. This intentionally
-- retains committed high-water marks after tickets are deleted. Existing ticket
-- numbers are considered on each call to accommodate manual staff numbers.
-- Rollback leaves the protected counter table in place for future reuse.
CREATE TABLE IF NOT EXISTS public.ticket_number_counters (
  ticket_year text PRIMARY KEY CHECK (ticket_year ~ '^[0-9]{4}$'),
  last_issued bigint NOT NULL CHECK (last_issued > 0)
);
ALTER TABLE public.ticket_number_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ticket_number_counters FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.generate_ticket_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  current_year text := to_char(now(), 'YYYY');
  prefix text := 'DOST02-ITS' || current_year;
  issued bigint;
BEGIN
  INSERT INTO public.ticket_number_counters AS counters (ticket_year, last_issued)
  VALUES (
    current_year,
    COALESCE((
      SELECT MAX(NULLIF(regexp_replace(SUBSTRING(t.ticket_number FROM char_length(prefix) + 1), '[^0-9]', '', 'g'), '')::bigint)
      FROM public.tickets t WHERE t.ticket_number LIKE prefix || '%'
    ), 0) + 1
  )
  ON CONFLICT (ticket_year) DO UPDATE
    SET last_issued = GREATEST(counters.last_issued + 1, EXCLUDED.last_issued)
  RETURNING last_issued INTO issued;

  -- Five digits are the minimum, not a maximum; do not truncate at 100000.
  NEW.ticket_number := prefix || lpad(issued::text, GREATEST(5, length(issued::text)), '0');
  RETURN NEW;
END;
$$;
