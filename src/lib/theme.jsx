import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase.js';
import { useSession } from './session.jsx';

/**
 * ThemeContext expõe a personalização ATIVA:
 *  - Pra nutri logada: usa o profile dela
 *  - Pra paciente logada: busca via RPC os dados da nutri dela
 *  - Pra anônimo (Login, signup, etc.): valores default Lapidare
 *
 * Aplica automaticamente:
 *  - CSS variables --gold-deep e --amber
 *  - data-tipografia no <html> (CSS controla o resto)
 *  - Disponibiliza marca/logo via hook useTheme()
 */

const DEFAULT_TEMA = {
  marca_nome: 'Lapidare',
  marca_subtitulo: null,
  logo_url: null,
  cor_primaria: '#a08456',
  cor_secundaria: '#c9a96e',
  tipografia: 'classica',
  mensagem_login: null,
  mensagem_termo: null,
};

const ThemeContext = createContext(DEFAULT_TEMA);

export function ThemeProvider({ children }) {
  const { profile, role } = useSession();
  const [tema, setTema] = useState(DEFAULT_TEMA);

  useEffect(() => {
    let active = true;
    async function carregar() {
      // Nutri logada: usa profile direto
      if (role === 'nutri' && profile) {
        if (!active) return;
        setTema({
          ...DEFAULT_TEMA,
          marca_nome:      profile.marca_nome      ?? 'Lapidare',
          marca_subtitulo: profile.marca_subtitulo ?? null,
          logo_url:        profile.logo_url        ?? null,
          cor_primaria:    profile.cor_primaria    ?? DEFAULT_TEMA.cor_primaria,
          cor_secundaria:  profile.cor_secundaria  ?? DEFAULT_TEMA.cor_secundaria,
          tipografia:      profile.tipografia      ?? 'classica',
          mensagem_login:  profile.mensagem_login  ?? null,
          mensagem_termo:  profile.mensagem_termo  ?? null,
        });
        return;
      }
      // Paciente logada: busca personalização da nutri dela
      if (role === 'paciente' && profile?.nutri_id) {
        const { data } = await supabase
          .rpc('buscar_personalizacao_nutri', { p_nutri_id: profile.nutri_id });
        if (!active) return;
        const p = data?.[0];
        setTema(p ? { ...DEFAULT_TEMA, ...p } : DEFAULT_TEMA);
        return;
      }
      // Anônimo (Login, signup, etc): busca a marca da "dona" do deploy
      // (a primeira/única nutri cadastrada), pra personalizar a tela de Login.
      // Se ainda não tem nutri criada (primeiro acesso), cai no fallback Lapidare.
      try {
        const { data } = await supabase.rpc('buscar_marca_principal');
        if (!active) return;
        const p = data?.[0];
        setTema(p ? { ...DEFAULT_TEMA, ...p } : DEFAULT_TEMA);
      } catch {
        if (!active) return;
        setTema(DEFAULT_TEMA);
      }
    }
    carregar();
    return () => { active = false; };
  }, [profile, role]);

  // Aplica CSS variables + tipografia
  useEffect(() => {
    const r = document.documentElement;
    const primaria   = tema.cor_primaria   ?? '#a08456';
    const secundaria = tema.cor_secundaria ?? '#c9a96e';

    // ─── Tokens visuais ───
    // Cores principais usadas pela nutri E paciente
    r.style.setProperty('--gold-deep', primaria);
    r.style.setProperty('--amber',     secundaria);
    r.style.setProperty('--gold',      secundaria);

    // --dark é a cor da sidebar + botões primários.
    // Substitui pela primária pra pintar SIDEBAR + BOTÕES + CARDS DARK.
    r.style.setProperty('--dark', primaria);

    // --ink (texto principal escuro) → usa a primária pra dar identidade
    // sem afetar legibilidade (cor escura por natureza).
    r.style.setProperty('--ink', primaria);

    // ─── Variantes do --dark usadas dentro da SIDEBAR ───
    // Threshold 0.45: pra cores medium-light (tan, rose gold), usa texto PRETO.
    // Muted é derivado DO TEXTO (não da primária) pra garantir contraste.
    const lum = luminancia(primaria);
    const primariaEhClara = lum > 0.45;

    // Cores de SHADE/LINE (variações escuras do fundo · hover/borda)
    r.style.setProperty('--dark-shade', mistura(primaria, '#000000', 0.15));
    r.style.setProperty('--dark-line',  mistura(primaria, '#000000', 0.25));

    if (primariaEhClara) {
      // Primária CLARA (tan, rose gold, lavanda) → texto PRETO + muted preto-acinzentado
      const textoBase = '#1a1612';
      r.style.setProperty('--dark-text',  textoBase);
      r.style.setProperty('--dark-muted', mistura(textoBase, primaria, 0.35));
      r.style.setProperty('--dark-label', mistura(textoBase, primaria, 0.55));
    } else {
      // Primária ESCURA (navy, preto, marrom) → texto BRANCO + muted branco-acinzentado
      const textoBase = '#faf8f5';
      r.style.setProperty('--dark-text',  textoBase);
      r.style.setProperty('--dark-muted', mistura(textoBase, primaria, 0.40));
      r.style.setProperty('--dark-label', mistura(textoBase, primaria, 0.60));
    }

    // Versões "soft" derivadas (background sutil com mesma matiz)
    r.style.setProperty('--gold-soft', mistura(primaria, '#ffffff', 0.82));
    r.style.setProperty('--amber-bg',  mistura(secundaria, '#ffffff', 0.88));

    // Backgrounds derivados da primária — controla telas de Login + wallpaper
    // (mistura forte com off-white pra ficar bem suave e legível)
    r.style.setProperty('--bg',      mistura(primaria, '#faf7f2', 0.95));
    r.style.setProperty('--bg-soft', mistura(primaria, '#faf7f2', 0.92));
    r.style.setProperty('--bg-deep', mistura(primaria, '#faf7f2', 0.86));

    r.dataset.tipografia = tema.tipografia ?? 'classica';
  }, [tema.cor_primaria, tema.cor_secundaria, tema.tipografia]);

  return (
    <ThemeContext.Provider value={tema}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}


/**
 * Mistura linear entre duas cores hex. peso = quanto da segunda cor (0..1).
 * mistura('#a08456', '#ffffff', 0.8) → cor primária com 80% de branco = soft.
 */
function mistura(hex1, hex2, peso) {
  const a = parseHex(hex1);
  const b = parseHex(hex2);
  if (!a || !b) return hex1;
  const r = Math.round(a.r * (1 - peso) + b.r * peso);
  const g = Math.round(a.g * (1 - peso) + b.g * peso);
  const bl = Math.round(a.b * (1 - peso) + b.b * peso);
  return `#${[r, g, bl].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

function parseHex(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? '');
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

/**
 * Luminância relativa percebida (WCAG-like, simplificado).
 * Retorna 0 (preto puro) a 1 (branco puro).
 * Usado pra decidir se a cor de texto deve ser clara ou escura.
 */
function luminancia(hex) {
  const c = parseHex(hex);
  if (!c) return 0.5;
  // Fórmula percebida (não a WCAG exata, mas suficiente pra decidir contraste)
  return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
}
