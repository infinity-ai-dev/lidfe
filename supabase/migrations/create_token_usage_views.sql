-- Views de uso de tokens (média e total diário)

CREATE OR REPLACE VIEW token_usage_daily AS
SELECT
    DATE_TRUNC('day', created_at)::date AS day,
    user_id,
    SUM(COALESCE(total_tokens, 0)) AS total_tokens,
    COUNT(*) AS message_count,
    ROUND(AVG(COALESCE(total_tokens, 0))::numeric, 2) AS avg_tokens_per_message,
    ROUND(AVG(NULLIF(total_tokens, 0))::numeric, 2) AS avg_tokens_per_message_nonzero
FROM anamnesechathistorico
GROUP BY 1, 2;

CREATE OR REPLACE VIEW token_usage_daily_thread AS
SELECT
    DATE_TRUNC('day', created_at)::date AS day,
    user_id,
    id_threadconversa AS thread_id,
    SUM(COALESCE(total_tokens, 0)) AS total_tokens,
    COUNT(*) AS message_count,
    ROUND(AVG(COALESCE(total_tokens, 0))::numeric, 2) AS avg_tokens_per_message,
    ROUND(AVG(NULLIF(total_tokens, 0))::numeric, 2) AS avg_tokens_per_message_nonzero
FROM anamnesechathistorico
GROUP BY 1, 2, 3;
