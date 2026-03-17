-- Criação da tabela para armazenar informações de autenticação de dois fatores (2FA)
CREATE TABLE IF NOT EXISTS user_two_factor_auth (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    secret TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_verified_at TIMESTAMPTZ
);

-- Índice para busca rápida por user_id
CREATE INDEX IF NOT EXISTS idx_user_two_factor_auth_user_id ON user_two_factor_auth(user_id);

-- Índice para busca rápida de usuários com 2FA habilitado
CREATE INDEX IF NOT EXISTS idx_user_two_factor_auth_enabled ON user_two_factor_auth(enabled) WHERE enabled = true;

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_user_two_factor_auth_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_user_two_factor_auth_updated_at
    BEFORE UPDATE ON user_two_factor_auth
    FOR EACH ROW
    EXECUTE FUNCTION update_user_two_factor_auth_updated_at();

-- RLS (Row Level Security) - permite que usuários vejam apenas seus próprios dados
ALTER TABLE user_two_factor_auth ENABLE ROW LEVEL SECURITY;

-- Política: usuários podem ver apenas seus próprios dados
CREATE POLICY "Users can view own 2FA data"
    ON user_two_factor_auth
    FOR SELECT
    USING (auth.uid() = user_id);

-- Política: usuários podem inserir apenas seus próprios dados
CREATE POLICY "Users can insert own 2FA data"
    ON user_two_factor_auth
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Política: usuários podem atualizar apenas seus próprios dados
CREATE POLICY "Users can update own 2FA data"
    ON user_two_factor_auth
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Política: usuários podem deletar apenas seus próprios dados
CREATE POLICY "Users can delete own 2FA data"
    ON user_two_factor_auth
    FOR DELETE
    USING (auth.uid() = user_id);








