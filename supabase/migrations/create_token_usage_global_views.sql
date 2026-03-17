-- Views gerais de uso de tokens (agregado total)

CREATE OR REPLACE VIEW token_usage_daily_global AS
SELECT
    DATE_TRUNC('day', created_at)::date AS day,
    SUM(COALESCE(total_tokens, 0)) AS total_tokens,
    COUNT(*) AS message_count,
    ROUND(AVG(COALESCE(total_tokens, 0))::numeric, 2) AS avg_tokens_per_message,
    ROUND(AVG(NULLIF(total_tokens, 0))::numeric, 2) AS avg_tokens_per_message_nonzero
FROM anamnesechathistorico
GROUP BY 1;

CREATE OR REPLACE VIEW token_usage_overall AS
SELECT
    SUM(COALESCE(total_tokens, 0)) AS total_tokens,
    COUNT(*) AS message_count,
    ROUND(AVG(COALESCE(total_tokens, 0))::numeric, 2) AS avg_tokens_per_message,
    ROUND(AVG(NULLIF(total_tokens, 0))::numeric, 2) AS avg_tokens_per_message_nonzero,
    MIN(created_at) AS first_message_at,
    MAX(created_at) AS last_message_at
FROM anamnesechathistorico;
