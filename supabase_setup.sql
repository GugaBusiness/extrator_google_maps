-- ====================================================
-- Script de Configuração do Banco de Dados MapsMiner
-- Execute este script no SQL Editor do Supabase
-- ====================================================

-- 1. Tabela de Perfis de Usuários (com controle de créditos)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  credits INTEGER DEFAULT 50 NOT NULL, -- Franquia de teste grátis
  plan TEXT DEFAULT 'free' NOT NULL,   -- 'free', 'starter', 'pro', 'growth'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Habilitar RLS (Row Level Security) na tabela de perfis
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Criar políticas de acesso à tabela de perfis
CREATE POLICY "Permitir leitura do próprio perfil" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Permitir atualização do próprio perfil" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- 2. Tabela de Histórico de Buscas
CREATE TABLE IF NOT EXISTS public.searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  query TEXT NOT NULL,
  city TEXT NOT NULL,
  limit_count INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' NOT NULL, -- 'pending', 'processing', 'completed', 'failed'
  json_filename TEXT,
  csv_filename TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

ALTER TABLE public.searches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir leitura das próprias buscas" ON public.searches
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Permitir inserção das próprias buscas" ON public.searches
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 3. Tabela de Leads Extraídos
CREATE TABLE IF NOT EXISTS public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id UUID REFERENCES public.searches(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  instagram TEXT,
  facebook TEXT,
  linkedin TEXT,
  youtube TEXT,
  address TEXT,
  rating NUMERIC(2,1),
  reviews_count INTEGER,
  lat TEXT,
  lng TEXT,
  url TEXT,
  has_whatsapp BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir leitura de leads de buscas próprias" ON public.leads
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.searches 
      WHERE public.searches.id = public.leads.search_id 
      AND public.searches.user_id = auth.uid()
    )
  );

-- ====================================================
-- GATILHO (TRIGGER) PARA CADASTRO AUTOMÁTICO DE PERFIL
-- Sempre que um usuário registrar no Supabase Auth,
-- cria-se o registro dele na tabela profiles automaticamente.
-- ====================================================

-- Função que o gatilho chamará
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, credits, plan)
  VALUES (new.id, new.email, 50, 'free');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Gatilho associado
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
