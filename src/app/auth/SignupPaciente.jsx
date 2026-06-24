import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase.js';
import { useSession } from '../../lib/session.jsx';
import BrandFooter from '../../components/BrandFooter.jsx';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function SignupPaciente() {
  const { nutriId, token } = useParams();
  const navigate = useNavigate();
  const { session, role, loading: sessionLoading } = useSession();

  const [nutriValida, setNutriValida] = useState(undefined);
  const [nutriNome, setNutriNome] = useState('');
  const [temToken, setTemToken] = useState(false);    // true se veio com token válido
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [nascimento, setNascimento] = useState('');
  const [sexo, setSexo] = useState('feminino');
  const [senha, setSenha] = useState('');
  const [confirmaSenha, setConfirmaSenha] = useState('');
  const [objetivo, setObjetivo] = useState('Emagrecimento');
  const [tipoPlano, setTipoPlano] = useState('trimestral');
  const [modalidade, setModalidade] = useState('Online');
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState(null);
  const [aviso, setAviso] = useState(null);

  // Valida que o nutri_id existe + busca pendente se vier token
  useEffect(() => {
    let active = true;
    async function validar() {
      if (!nutriId || !UUID_RE.test(nutriId)) {
        if (active) setNutriValida(false);
        return;
      }

      // Se veio token, busca o pendente pré-cadastrado
      if (token && UUID_RE.test(token)) {
        const { data, error } = await supabase
          .rpc('buscar_pendente_por_token', { p_token: token });
        if (!active) return;
        if (!error && data?.length > 0) {
          const p = data[0];
          if (p.status === 'ativado') {
            // Já criou conta antes
            setNutriValida(false);
            return;
          }
          setNome(p.nome ?? '');
          setEmail(p.email ?? '');
          if (p.nascimento) setNascimento(p.nascimento);
          if (p.sexo) setSexo(p.sexo);
          if (p.objetivo) setObjetivo(p.objetivo);
          if (p.tipo_plano) setTipoPlano(p.tipo_plano);
          if (p.modalidade) setModalidade(p.modalidade);
          setNutriNome(p.nutri_nome ?? '');
          setTemToken(true);
          setNutriValida(true);
          return;
        }
      }

      // Sem token: fluxo genérico (busca só o nome da nutri)
      const { data } = await supabase
        .from('nutris')
        .select('nome')
        .eq('id', nutriId)
        .maybeSingle();
      if (!active) return;
      if (data) {
        setNutriValida(true);
        setNutriNome(data.nome ?? '');
      } else {
        setNutriValida(false);
      }
    }
    validar();
    return () => { active = false; };
  }, [nutriId, token]);

  // Se já está logada como paciente, manda pro app.
  // Se já está logada como nutri, NÃO redireciona — mostra uma mensagem
  // (ela pode estar testando o link da paciente que cadastrou).
  useEffect(() => {
    if (sessionLoading || !session) return;
    if (role === 'paciente') navigate('/paciente/inicio', { replace: true });
  }, [session, role, sessionLoading, navigate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setErro(null); setAviso(null);
    if (!nome.trim()) return setErro('Informe seu nome completo.');
    if (senha.length < 6) return setErro('A senha precisa de pelo menos 6 caracteres.');
    if (senha !== confirmaSenha) return setErro('As senhas não conferem.');

    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password: senha,
      options: {
        data: {
          role: 'paciente',
          nutri_id: nutriId,
          nome: nome.trim(),
          nascimento: nascimento || null,
          sexo,
          objetivo,
          tipo_plano: tipoPlano,
          modalidade,
        },
      },
    });
    setBusy(false);
    if (error) return setErro(error.message);

    if (data.session) {
      // confirm email desligado → loga direto
      navigate('/paciente/inicio', { replace: true });
    } else {
      setAviso('Cadastro feito! Verifique seu email para confirmar e depois faça login.');
    }
  }

  // Telas de estado
  if (nutriValida === undefined) {
    return <CenterWrap><Loading /></CenterWrap>;
  }

  if (nutriValida === false) {
    return (
      <CenterWrap>
        <Box>
          <Brand />
          <h1 style={H1}>Link inválido</h1>
          <p style={P}>
            Este link de cadastro não está mais ativo ou foi digitado incorretamente.
            Peça à sua nutricionista um novo link.
          </p>
        </Box>
      </CenterWrap>
    );
  }

  // Nutri logada abrindo o link da própria paciente — mostra aviso útil
  if (role === 'nutri') {
    async function sairETestar() {
      await supabase.auth.signOut();
      // recarrega na mesma URL — depois do logout vai mostrar a tela da paciente
      window.location.reload();
    }
    return (
      <CenterWrap>
        <Box>
          <Brand />
          <h1 style={H1}>Link da paciente</h1>
          <p style={P}>
            Este é o link de cadastro de <strong>{nome || 'sua paciente'}</strong>.
            Você está logada como nutri — envie este link pra ela ou abra em uma
            janela anônima pra ver como ela vai ver.
          </p>

          <div style={{
            background: 'var(--bg-soft, #faf7f2)',
            border: '0.5px solid var(--hair, #d9d3c9)',
            borderRadius: 10, padding: 12, margin: '16px 0',
            fontSize: 12, textAlign: 'left', lineHeight: 1.5,
            wordBreak: 'break-all', fontFamily: 'monospace',
            color: 'var(--ink-soft)',
          }}>
            {window.location.href}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={() => navigate('/nutri/cadastrar', { replace: true })}
              style={{
                flex: 1, padding: '10px 14px',
                background: 'var(--ink)', color: 'var(--bg-soft)',
                borderRadius: 10, fontSize: 12, fontWeight: 500,
                border: 'none', cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
              }}>
              ← Voltar pro painel
            </button>
            <button onClick={sairETestar}
              style={{
                flex: 1, padding: '10px 14px',
                background: 'var(--white)', color: 'var(--ink)',
                border: '0.5px solid var(--hair, #d9d3c9)',
                borderRadius: 10, fontSize: 12, fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
              }}>
              Sair e testar como paciente
            </button>
          </div>

          <p style={{ marginTop: 14, fontSize: 11, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.5 }}>
            Dica: abrir o link em uma <strong>janela anônima</strong> (Cmd+Shift+N) deixa você
            testar sem deslogar do painel.
          </p>
        </Box>
      </CenterWrap>
    );
  }

  return (
    <CenterWrap>
      <Box>
        <Brand />
        <h1 style={H1}>{temToken ? `Bem-vinda, ${nome.split(' ')[0] || ''}!` : 'Criar minha conta'}</h1>
        <p style={P}>
          {temToken
            ? `${nutriNome} te cadastrou. Só falta criar uma senha pra entrar.`
            : (nutriNome ? `Você foi ${sexo === 'masculino' ? 'convidado' : 'convidada'} por ${nutriNome}` : 'Cadastro de paciente')}
        </p>

        <form onSubmit={handleSubmit} style={{ marginTop: 16 }}>
          {temToken ? (
            <>
              {/* Mostra dados pré-preenchidos só pra confirmação visual */}
              <div style={{
                background: 'var(--bg-soft, #faf7f2)',
                border: '0.5px solid var(--hair, #d9d3c9)',
                borderRadius: 10, padding: 12, marginBottom: 14,
                fontSize: 12, lineHeight: 1.6, textAlign: 'left',
              }}>
                <div><strong>Nome:</strong> {nome}</div>
                <div><strong>Email:</strong> {email}</div>
                {nascimento && <div><strong>Nascimento:</strong> {new Date(nascimento + 'T12:00:00').toLocaleDateString('pt-BR')}</div>}
                <div style={{ marginTop: 6, color: 'var(--muted)' }}>
                  Se algum dado estiver errado, fale com {nutriNome.split(' ')[0]} antes de continuar.
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Field label="Crie uma senha" type="password" value={senha} onChange={setSenha} required minLength={6} autoFocus />
                <Field label="Confirme a senha" type="password" value={confirmaSenha} onChange={setConfirmaSenha} required minLength={6} />
              </div>
            </>
          ) : (
            <>
              <Field label="Nome completo" value={nome} onChange={setNome} required autoFocus />

              <Field label="Email" type="email" value={email} onChange={setEmail} required />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Field label="Data de nascimento" type="date" value={nascimento} onChange={setNascimento} />
                <SelectField label="Sexo" value={sexo} onChange={setSexo} options={[
                  { v: 'feminino',  l: 'Feminino' },
                  { v: 'masculino', l: 'Masculino' },
                ]} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Field label="Senha" type="password" value={senha} onChange={setSenha} required minLength={6} />
                <Field label="Confirmar senha" type="password" value={confirmaSenha} onChange={setConfirmaSenha} required minLength={6} />
              </div>

              <SelectField label="Objetivo" value={objetivo} onChange={setObjetivo} options={[
                'Emagrecimento', 'Hipertrofia', 'Reeducação alimentar', 'Saúde geral', 'Performance esportiva',
              ]} />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <SelectField label="Tipo de plano" value={tipoPlano} onChange={setTipoPlano} options={[
                  { v: 'trimestral',     l: 'Trimestral' },
                  { v: 'semestral',      l: 'Semestral' },
                  { v: 'consultoria',    l: 'Consultoria' },
                  { v: 'acompanhamento', l: 'Acompanhamento' },
                ]} />
                <SelectField label="Modalidade" value={modalidade} onChange={setModalidade} options={[
                  'Presencial', 'Online', 'Híbrido',
                ]} />
              </div>
            </>
          )}

          {erro && (
            <div style={{ ...AlertCss, background: 'var(--red-soft)', color: 'var(--red)' }}>
              {erro}
            </div>
          )}
          {aviso && (
            <div style={{ ...AlertCss, background: 'var(--green-soft)', color: 'var(--green)' }}>
              {aviso}
            </div>
          )}

          <button type="submit" disabled={busy} style={{
            width: '100%', padding: '11px 18px',
            background: 'var(--ink)', color: 'var(--bg-soft)',
            borderRadius: 12, fontSize: 13, fontWeight: 500,
            border: 'none', cursor: 'pointer',
            opacity: busy ? .6 : 1, marginTop: 4,
          }}>
            {busy ? 'Criando conta...' : (temToken ? 'Criar senha e entrar' : 'Criar minha conta')}
          </button>
        </form>

        <p style={{ marginTop: 16, fontSize: 11, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.5 }}>
          Já tem conta? <a href="/login" style={{ color: 'var(--gold-deep)', textDecoration: 'none' }}>Entrar</a>
        </p>
      </Box>
    </CenterWrap>
  );
}

/* ── helpers de UI ── */
const H1 = { fontFamily: 'var(--font-serif)', fontWeight: 500, fontSize: 28, letterSpacing: '-0.02em', color: 'var(--ink)', marginTop: 4 };
const P = { fontSize: 12, color: 'var(--muted)', marginTop: 6, textAlign: 'center' };
const AlertCss = { fontSize: 12, padding: '8px 12px', borderRadius: 8, marginTop: 10, marginBottom: 10 };

function CenterWrap({ children }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, var(--bg-soft) 0%, var(--bg-deep) 100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 24, fontFamily: 'var(--font-sans)',
    }}>
      {children}
      <BrandFooter />
    </div>
  );
}

function Box({ children }) {
  return (
    <div style={{
      width: '100%', maxWidth: 420,
      background: 'var(--paper)',
      border: '0.5px solid var(--hair, #d9d3c9)',
      borderRadius: 20,
      boxShadow: '0 4px 12px rgba(28,23,18,.06), 0 2px 4px rgba(28,23,18,.04)',
      padding: 32, textAlign: 'center',
    }}>{children}</div>
  );
}

function Brand() {
  return (
    <div style={{ fontSize: 10, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4 }}>
      Lapidare
    </div>
  );
}

function Loading() {
  return <Box><div style={{ color: 'var(--muted)', fontSize: 13 }}>Validando link…</div></Box>;
}

function Field({ label, value, onChange, type = 'text', required, autoFocus, minLength }) {
  return (
    <label style={{ display: 'block', marginBottom: 12, textAlign: 'left' }}>
      <span style={{
        display: 'block', fontSize: 11, letterSpacing: '.04em',
        color: 'var(--ink-soft)', marginBottom: 5, fontWeight: 500,
      }}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
        autoFocus={autoFocus}
        minLength={minLength}
        style={{
          width: '100%', padding: '10px 12px', fontSize: 13,
          background: 'var(--bg-soft)',
          border: '0.5px solid var(--hair, #d9d3c9)',
          borderRadius: 10, outline: 'none',
          color: 'var(--ink)',
          fontFamily: 'var(--font-sans)',
          boxSizing: 'border-box',
        }}
      />
    </label>
  );
}

function SelectField({ label, value, onChange, options }) {
  const opts = options.map(o => typeof o === 'string' ? { v: o, l: o } : o);
  return (
    <label style={{ display: 'block', marginBottom: 12, textAlign: 'left' }}>
      <span style={{
        display: 'block', fontSize: 11, letterSpacing: '.04em',
        color: 'var(--ink-soft)', marginBottom: 5, fontWeight: 500,
      }}>{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', padding: '10px 12px', fontSize: 13,
          background: 'var(--bg-soft)',
          border: '0.5px solid var(--hair, #d9d3c9)',
          borderRadius: 10, outline: 'none',
          color: 'var(--ink)',
          fontFamily: 'var(--font-sans)',
          boxSizing: 'border-box',
        }}>
        {opts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </label>
  );
}
