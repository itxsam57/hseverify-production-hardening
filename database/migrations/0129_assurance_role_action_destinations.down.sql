-- Restoring the old constraint rewrites only role-specific destinations to their
-- recorded Company assurance order before narrowing valid paths.
UPDATE assurance_action_items
   SET deep_link='/company/assurance-orders/'||order_id
                ||CASE WHEN case_id IS NOT NULL THEN '#'||case_id ELSE '' END
 WHERE deep_link !~ '^/company/assurance-orders/assurance_order_[A-Za-z0-9_-]{24}(?:[#?][A-Za-z0-9_./:@?=&%-]+)?$';

ALTER TABLE assurance_action_items
  DROP CONSTRAINT IF EXISTS assurance_action_items_deep_link_check;

ALTER TABLE assurance_action_items
  ADD CONSTRAINT assurance_action_items_deep_link_check CHECK (
    deep_link ~ '^/company/assurance-orders/assurance_order_[A-Za-z0-9_-]{24}(?:[#?][A-Za-z0-9_./:@?=&%-]+)?$'
  );
