-- Extend exact-role action destinations without weakening the original Company case route.
ALTER TABLE assurance_action_items
  DROP CONSTRAINT IF EXISTS assurance_action_items_deep_link_check;

ALTER TABLE assurance_action_items
  ADD CONSTRAINT assurance_action_items_deep_link_check CHECK (
    deep_link ~ '^/company/assurance-orders/assurance_order_[A-Za-z0-9_-]{24}(?:[#?][A-Za-z0-9_./:@?=&%-]+)?$'
    OR deep_link ~ '^/worker/assurance-cases/assurance_case_[A-Za-z0-9_-]{24}$'
    OR deep_link = '/verifier/reviews/scoring'
    OR deep_link ~ '^/admin/operations/scoring-assignments#assurance_case_[A-Za-z0-9_-]{24}$'
    OR deep_link = '/admin/assessor-matching'
    OR deep_link ~ '^/assessor/interviews/interview_request_[A-Za-z0-9_-]{24}$'
  );
