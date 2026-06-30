import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useSession } from '../../lib/session.jsx';

// Limpa o nome do item: tira quantidade (após "—" ou "-") e parênteses.
// Retorna null se for um item de substituição (deve ser filtrado).
function limparItem(raw) {
  if (!raw || typeof raw !== 'string') return null;
  // Filtra substitutos: "(substituição de ...)", "(substitui ...)"
  if (/\(\s*substitui/i.test(raw)) return null;
  // Quebra na primeira ocorrência de " — ", " – " ou " - "
  let s = raw.split(/\s+[—–-]\s+/)[0];
  // Remove qualquer texto entre parênteses
  s = s.replace(/\s*\([^)]*\)/g, '');
  s = s.trim();
  return s || null;
}

// Aplica limparItem em toda a lista e remove itens vazios/substitutos.
// Também dedupe dentro da mesma categoria (case-insensitive).
function limparLista(compras) {
  if (!compras?.lista) return compras;
  const novasCategorias = compras.lista
    .map(cat => {
      const vistos = new Set();
      const itensLimpos = (cat.itens ?? [])
        .map(limparItem)
        .filter(Boolean)
        .filter(nome => {
          const k = nome.toLowerCase();
          if (vistos.has(k)) return false;
          vistos.add(k);
          return true;
        });
      return { ...cat, itens: itensLimpos };
    })
    .filter(cat => cat.itens.length > 0);
  return { ...compras, lista: novasCategorias };
}

export default function Compras() {
  const { user } = useSession();
  const [compras, setCompras] = useState(undefined);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [marcados, setMarcados] = useState({});

  useEffect(() => {
    let active = true;
    async function load() {
      if (!user) return;
      const { data } = await supabase
        .from('listas_compras')
        .select('dados, pdf_url, publicado_em')
        .eq('paciente_id', user.id)
        .order('publicado_em', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!active) return;
      setCompras(data?.dados ?? null);
      setPdfUrl(data?.pdf_url ?? null);
    }
    load();
    return () => { active = false; };
  }, [user]);

  // Lista limpa: sem quantidades, sem substitutos, sem duplicados.
  const comprasLimpas = useMemo(() => compras ? limparLista(compras) : compras, [compras]);

  if (compras === undefined) {
    return <div className="empty-state"><div className="empty-sub">Carregando…</div></div>;
  }

  if (!compras) {
    return (
      <div className="empty-state">
        <i className="ti ti-shopping-cart empty-icon" aria-hidden="true"></i>
        <div className="empty-title">Lista não enviada ainda</div>
        <div className="empty-sub">
          Sua nutricionista enviará a lista de compras junto com o plano alimentar.
        </div>
      </div>
    );
  }

  // Lista publicada SÓ como PDF (sem JSON estruturado) — mostra tela amigável.
  const somentePdf = compras.somente_pdf === true || !Array.isArray(compras.lista);
  if (somentePdf && pdfUrl) {
    return (
      <div style={{ padding: '24px 16px', textAlign: 'center' }}>
        <i className="ti ti-shopping-cart" style={{ fontSize: 40, color: 'var(--gold-deep)', display: 'block', marginBottom: 12 }}></i>
        <div className="serif" style={{ fontSize: 20, marginBottom: 6 }}>Sua lista de compras</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 18, lineHeight: 1.5 }}>
          Sua nutricionista enviou a lista em PDF. Toque pra baixar.
        </div>
        <a href={pdfUrl} target="_blank" rel="noopener noreferrer"
           style={{
             display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
             padding: '12px 24px', borderRadius: 10,
             background: 'var(--gold-bg, #fff7e0)', color: 'var(--gold-deep, #5a4400)',
             border: '1px solid var(--gold, #c9a86a)',
             fontSize: 14, fontWeight: 500, textDecoration: 'none',
           }}>
          <i className="ti ti-file-download" style={{ fontSize: 18 }} aria-hidden="true"></i>
          Baixar PDF da lista
        </a>
      </div>
    );
  }

  const totalItens = comprasLimpas.lista?.reduce((a, c) => a + (c.itens?.length ?? 0), 0) ?? 0;
  const totalMarcados = Object.values(marcados).filter(Boolean).length;

  const toggle = (key) => setMarcados(m => ({ ...m, [key]: !m[key] }));

  return (
    <>
      {pdfUrl && (
        <div style={{ padding: '0 16px 12px' }}>
          <a href={pdfUrl} target="_blank" rel="noopener noreferrer"
             style={{
               display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
               width: '100%', padding: '10px 14px', borderRadius: 10,
               background: 'var(--gold-bg, #fff7e0)', color: 'var(--gold-deep, #5a4400)',
               border: '1px solid var(--gold, #c9a86a)',
               fontSize: 13, fontWeight: 500, textDecoration: 'none',
             }}>
            <i className="ti ti-file-download" style={{ fontSize: 16 }} aria-hidden="true"></i>
            Baixar PDF da lista de compras
          </a>
        </div>
      )}
      <div className="card" style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 500 }}>
            Progresso
          </span>
          <span className="pill ghost">{totalMarcados}/{totalItens} itens</span>
        </div>
        <div className="bar">
          <i style={{ width: `${totalItens > 0 ? (totalMarcados / totalItens) * 100 : 0}%`, background: 'var(--green)' }}></i>
        </div>
      </div>

      {comprasLimpas.lista?.map((cat, ci) => (
        <div key={ci} className="card" style={{ padding: '12px 16px' }}>
          <div style={{
            fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase',
            color: 'var(--gold-deep)', fontWeight: 500, marginBottom: 8,
            display: 'flex', alignItems: 'center', gap: 6
          }}>
            {cat.emoji && <span>{cat.emoji}</span>}
            <span>{cat.categoria}</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--muted)' }}>{cat.itens?.length ?? 0} itens</span>
          </div>
          {cat.itens?.map((item, ii) => {
            const key = `${ci}-${ii}`;
            const done = !!marcados[key];
            return (
              <div key={ii} className={`compra-item ${done ? 'done' : ''}`} onClick={() => toggle(key)}>
                <button className={`check ${done ? 'done' : ''}`}
                  onClick={(e) => { e.stopPropagation(); toggle(key); }}
                  aria-label={done ? 'Desmarcar' : 'Marcar'}>
                  <i className="ti ti-check"></i>
                </button>
                <span className="compra-nome">{item}</span>
              </div>
            );
          })}
        </div>
      ))}

      {totalMarcados === totalItens && totalItens > 0 && (
        <div style={{ margin: '0 16px 16px', textAlign: 'center', padding: 16, background: 'var(--green-soft)', borderRadius: 12 }}>
          <div style={{ fontSize: 20, marginBottom: 4 }}>🎉</div>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--green)' }}>Lista completa!</div>
        </div>
      )}
    </>
  );
}
