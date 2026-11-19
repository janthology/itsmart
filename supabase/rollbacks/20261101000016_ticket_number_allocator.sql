-- Restore the previous function only after explicit approval and live drift
-- checks. This reopens MAX+1 races and may reuse numbers after deletion. The
-- protected counter table is deliberately retained so its high-water marks are
-- not discarded; it is not used by the restored function.
CREATE OR REPLACE FUNCTION public.generate_ticket_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_year TEXT;
  prefix       TEXT;
  seq_num      INT;
BEGIN
  current_year := TO_CHAR(NOW(), 'YYYY');
  prefix := 'DOST02-ITS' || current_year;

  SELECT COALESCE(
    MAX(
      NULLIF(
        regexp_replace(SUBSTRING(ticket_number FROM char_length(prefix) + 1), '[^0-9]', '', 'g'),
        ''
      )::INT
    ),
    0
  ) + 1
    INTO seq_num
    FROM public.tickets
   WHERE ticket_number LIKE prefix || '%';

  NEW.ticket_number := prefix || LPAD(seq_num::TEXT, 5, '0');
  RETURN NEW;
END;
$$;
