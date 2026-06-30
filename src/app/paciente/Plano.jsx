import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useSession } from '../../lib/session.jsx';
import { dataBR, indexarSubstituicoes, gen } from '../../lib/utils.js';

/**
 * Renderiza uma substituição com segurança — aceita string OU objeto.
 *
 * Antes era só `→ {s}` direto no JSX, mas se a Skill 6 (ChatGPT) gerasse
 * o JSON com substituições como objetos (ex: `{nome: "Pão", qty: "2 fatias"}`)
 * em vez de strings simples, React crashava a tela inteira (Erro:
 * "Objects are not valid as a React child"). Resultado: tela branca ao
 * clicar em "Ver substituições".
 *
 * Agora aceita os 2 formatos:
 *   - string: "Pão integral - 2 fatias" → usa direto
 *   - objeto: { nome: "Pão", qty: "2 fatias", kcal: 80 } → monta "Pão · 2 fatias · 80 kcal"
 */
function formatarSub(s) {
  if (typeof s === 'string') return s;
  if (!s || typeof s !== 'object') return String(s ?? '');
  const partes = [s.nome, s.qty, s.kcal && `${s.kcal} kcal`].filter(Boolean);
  return partes.length ? partes.join(' · ') : JSON.stringify(s);
}

export default function Plano() {
  const { user, profile } = useSession();
  const [plano, setPlano] = useState(undefined); // undefined=loading, null=vazio
  const [validade, setValidade] = useState(null);
  const [pdfPlano, setPdfPlano] = useState(null);          // URL do PDF do plano
  const [subsExternas, setSubsExternas] = useState(null);  // dados da tabela substituicoes
  const [pdfSubs, setPdfSubs] = useState(null);            // URL do PDF de substituições
  const [openSubs, setOpenSubs] = useState({});

  useEffect(() => {
    let active = true;
    async function load() {
      if (!user) return;
      const [pRes, sRes] = await Promise.all([
        supabase
          .from('planos')
          .select('dados, validade, pdf_url, publicado_em')
          .eq('paciente_id', user.id)
          .order('publicado_em', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('substituicoes')
          .select('dados, pdf_url, publicado_em')
          .eq('paciente_id', user.id)
          .order('publicado_em', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (!active) return;
      setPlano(pRes.data?.dados ?? null);
      setValidade(pRes.data?.validade ?? null);
      setPdfPlano(pRes.data?.pdf_url ?? null);
      setSubsExternas(sRes.data?.dados ?? null);
      setPdfSubs(sRes.data?.pdf_url ?? null);
    }
    load();
    return () => { active = false; };
  }, [user]);

  // Índice nome_alimento -> [substituições], construído da tabela substituicoes.
  // Faz lookup case-insensitive quando paciente clica em "Ver substituições".
  const indiceSubs = useMemo(() => indexarSubstituicoes(subsExternas), [subsExternas]);

  const toggleSubs = (key) => setOpenSubs(s => ({ ...s, [key]: !s[key] }));

  if (plano === undefined) {
    return <div className="empty-state"><div className="empty-sub">Carregando…</div></div>;
  }

  if (!plano) {
    return (
      <div className="empty-state">
        <i className="ti ti-salad empty-icon" aria-hidden="true"></i>
        <div className="empty-title">Plano não publicado ainda</div>
        <div className="empty-sub">
          Sua nutricionista está preparando seu plano personalizado. Você será {gen(profile?.sexo, 'notificado', 'notificada')} quando estiver pronto.
        </div>
      </div>
    );
  }

  // Plano foi publicado SÓ como PDF (sem JSON estruturado).
  // Mostra tela amigável só com botão de baixar.
  const somentePdf = plano.somente_pdf === true || !Array.isArray(plano.refeicoes);
  if (somentePdf && pdfPlano) {
    return (
      <div style={{ padding: '24px 16px', textAlign: 'center' }}>
        <i className="ti ti-file-text" style={{ fontSize: 40, color: 'var(--gold-deep)', display: 'block', marginBottom: 12 }}></i>
        <div className="serif" style={{ fontSize: 20, marginBottom: 6 }}>Seu plano alimentar</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 18, lineHeight: 1.5 }}>
          Sua nutricionista enviou o plano em PDF. Toque pra baixar e visualizar.
        </div>
        <a href={pdfPlano} target="_blank" rel="noopener noreferrer"
           style={{
             display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
             padding: '12px 24px', borderRadius: 10,
             background: 'var(--gold-bg, #fff7e0)', color: 'var(--gold-deep, #5a4400)',
             border: '1px solid var(--gold, #c9a86a)',
             fontSize: 14, fontWeight: 500, textDecoration: 'none',
           }}>
          <i className="ti ti-file-download" style={{ fontSize: 18 }} aria-hidden="true"></i>
          Baixar PDF do plano
        </a>
        {pdfSubs && (
          <div style={{ marginTop: 12 }}>
            <a href={pdfSubs} target="_blank" rel="noopener noreferrer"
               style={{
                 display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                 padding: '8px 18px', borderRadius: 10,
                 background: 'var(--bg2)', color: 'var(--text2)',
                 border: '0.5px solid var(--border)',
                 fontSize: 13, fontWeight: 500, textDecoration: 'none',
               }}>
              <i className="ti ti-file-download" style={{ fontSize: 14 }} aria-hidden="true"></i>
              Baixar PDF das substituições
            </a>
          </div>
        )}
        {validade && (
          <div style={{ marginTop: 16, fontSize: 11, color: 'var(--muted)' }}>
            Válido até {dataBR(validade)}
          </div>
        )}
      </div>
    );
  }

  const totalFeitos = plano.refeicoes?.filter(r => r.feita).length ?? 0;
  const total = plano.refeicoes?.length ?? 0;

  return (
    <>
      {/* Botões de PDF (se a nutri anexou) */}
      {(pdfPlano || pdfSubs) && (
        <div style={{ display: 'flex', gap: 8, padding: '0 16px 12px', flexWrap: 'wrap' }}>
          {pdfPlano && (
            <a href={pdfPlano} target="_blank" rel="noopener noreferrer"
               className="pdf-download-btn"
               style={{
                 flex: 1, minWidth: 140,
                 display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                 padding: '10px 14px', borderRadius: 10,
                 background: 'var(--gold-bg, #fff7e0)', color: 'var(--gold-deep, #5a4400)',
                 border: '1px solid var(--gold, #c9a86a)',
                 fontSize: 13, fontWeight: 500, textDecoration: 'none',
               }}>
              <i className="ti ti-file-download" style={{ fontSize: 16 }} aria-hidden="true"></i>
              Baixar PDF do plano
            </a>
          )}
          {pdfSubs && (
            <a href={pdfSubs} target="_blank" rel="noopener noreferrer"
               className="pdf-download-btn"
               style={{
                 flex: 1, minWidth: 140,
                 display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                 padding: '10px 14px', borderRadius: 10,
                 background: 'var(--gold-bg, #fff7e0)', color: 'var(--gold-deep, #5a4400)',
                 border: '1px solid var(--gold, #c9a86a)',
                 fontSize: 13, fontWeight: 500, textDecoration: 'none',
               }}>
              <i className="ti ti-file-download" style={{ fontSize: 16 }} aria-hidden="true"></i>
              Baixar PDF das substituições
            </a>
          )}
        </div>
      )}

      {/* Macros */}
      <div className="card" style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 500 }}>
            Macros do dia
          </span>
          <span className="pill ghost" style={{ fontSize: 10 }}>{plano.macros?.kcal} kcal</span>
        </div>
        {[
          { label: 'Proteína',    v: plano.macros?.prot_g, color: 'var(--red)' },
          { label: 'Carboidrato', v: plano.macros?.cho_g,  color: 'var(--gold)' },
          { label: 'Gordura',     v: plano.macros?.lip_g,  color: 'var(--green)' },
        ].map((m, i) => (
          <div key={i} className="macro-row">
            <div className="macro-label"><span>{m.label}</span><span>{m.v}g</span></div>
            <div className="bar"><i style={{ width: '70%', background: m.color }}></i></div>
          </div>
        ))}
        {(plano.macros?.agua_l || plano.macros?.fibras_g) && (
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
            💧 Meta: {plano.macros.agua_l}L · 🌾 Fibras: {plano.macros.fibras_g}g
          </div>
        )}
      </div>

      {/* Progresso */}
      {total > 0 && (
        <div style={{ margin: '0 16px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="bar" style={{ flex: 1 }}>
            <i style={{ width: `${(totalFeitos / total) * 100}%`, background: 'var(--green)' }}></i>
          </div>
          <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
            {totalFeitos}/{total} refeições
          </span>
        </div>
      )}

      {/* Refeições */}
      {plano.refeicoes?.map((ref, ri) => (
        <div key={ri} className="refeicao-card">
          <div className="refeicao-header">
            <div>
              <div className="refeicao-titulo">{ref.emoji} {ref.nome}</div>
              {ref.horario && <div className="refeicao-horario">{ref.horario}</div>}
            </div>
            {ref.kcal && <span className="refeicao-kcal">{ref.kcal} kcal</span>}
          </div>

          {ref.alimentos?.map((al, ai) => (
            <div key={ai}>
              <div className="alimento-row" style={{ background: ai % 2 === 0 ? 'var(--paper)' : 'var(--bg-soft)' }}>
                <div>
                  <div className="alimento-nome">{al.nome}</div>
                  {al.qty && <div className="alimento-qty">{al.qty}{al.prot_g ? ` · ${al.prot_g}g prot` : ''}</div>}
                </div>
                {al.kcal && <span className="alimento-kcal">{al.kcal} kcal</span>}
              </div>

              {(() => {
                // Prioridade: tabela substituicoes (novo) > campo subs no plano (legado)
                const externas = indiceSubs[String(al.nome ?? '').trim().toLowerCase()] ?? [];
                const subs = externas.length > 0 ? externas : (Array.isArray(al.subs) ? al.subs : []);
                if (subs.length === 0) return null;
                return (
                  <>
                    <button className="subs-toggle" onClick={() => toggleSubs(`${ri}-${ai}`)}>
                      <i className={`ti ti-${openSubs[`${ri}-${ai}`] ? 'chevron-up' : 'chevron-down'}`} style={{ fontSize: 12 }} aria-hidden="true"></i>
                      {openSubs[`${ri}-${ai}`] ? 'Fechar substituições' : `Ver ${subs.length} substituições`}
                    </button>
                    {openSubs[`${ri}-${ai}`] && (
                      <div className="subs-list">
                        {subs.map((s, si) => (
                          <div key={si} className="sub-item">→ {formatarSub(s)}</div>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          ))}

          {ref.obs && (
            <div className="refeicao-obs">
              <i className="ti ti-info-circle" style={{ fontSize: 12, marginRight: 5, color: 'var(--gold-deep)' }} aria-hidden="true"></i>
              {ref.obs}
            </div>
          )}
        </div>
      ))}

      {validade && (
        <div style={{ padding: '8px 16px', fontSize: 10, color: 'var(--muted)', textAlign: 'center' }}>
          Válido até {dataBR(validade)}
        </div>
      )}
    </>
  );
}
