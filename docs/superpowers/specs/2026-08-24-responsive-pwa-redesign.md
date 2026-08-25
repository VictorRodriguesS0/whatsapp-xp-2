# XP Atendimento — Redesign responsivo, acessível e PWA

**Data:** 24 de agosto de 2026  
**Status:** Aprovado para planejamento e implementação  
**Aplicação auditada:** `https://whatsapp.xpeletronicos.com`  
**Referência de marca:** `https://www.xpeletronicos.com`

## 1. Resultado esperado

Reformular todo o frontend do XP Atendimento para entregar uma experiência inspirada na familiaridade operacional do WhatsApp, visualmente mais refinada e alinhada à identidade real da XP Eletrônicos. A aplicação deverá funcionar sem rolagem horizontal a partir de 320 px, oferecer modos claro e escuro acessíveis e poder ser instalada como PWA em modo `standalone`, permanecendo sempre online.

O redesign preservará o backend, as APIs, a autenticação, o SSE e todas as funções existentes. A implantação em produção só ocorrerá depois da verificação automatizada, visual e funcional completa.

## 2. Evidências da auditoria

A aplicação publicada foi inspecionada no navegador com dados e estados reais, em larguras de 1440, 900, 390 e 320 px. A auditoria encontrou:

- estrutura desktop de três colunas funcional, porém visualmente neutra e pouco alinhada à marca;
- itens da lista de conversas altos e carregados de metadados;
- cabeçalho da conversa excessivamente comprimido em 320 px;
- ações de responder e reagir visualmente soltas ao redor das mensagens no celular;
- atualização da lista capaz de substituir o conteúdo por uma grande área de carregamento;
- página de usuários baseada em tabela larga e rolagem horizontal no celular;
- login responsivo, mas sem presença visual suficiente da XP;
- páginas de classificações e respostas rápidas razoavelmente responsivas;
- boa base semântica, de foco e de rótulos acessíveis;
- controles segmentados com apenas 36 px de altura;
- ausência de manifesto, ícones, metadados de instalação, tema do navegador e configuração PWA.

## 3. Decisões aprovadas

### 3.1 Direção visual

**Direção escolhida:** “WhatsApp refinado + identidade XP”.

A interface manterá o modelo mental conhecido — lista, conversa e dados do cliente — sem copiar pixels, assets ou identidade proprietária do WhatsApp. A XP será reconhecida por tipografia, símbolo, cores, ritmo e acabamento.

**Tese visual:** uma central operacional precisa e calma, construída com superfícies neutras, tipografia Geist, contraste forte e pequenos acentos tecnológicos da identidade multicolorida da XP.

**Hierarquia de conteúdo:**

1. workspace de atendimento e estado da conexão;
2. conversas, filtros e prioridade;
3. histórico e composição de resposta;
4. contexto do contato, classificação e responsável;
5. configurações administrativas adaptativas.

### 3.2 Identidade da XP

O site da loja define os seguintes elementos de marca:

- símbolo: controle colorido da XP;
- tipografia: Geist Sans e Geist Mono quando necessário;
- preto: `#050505`;
- papel: `#F5F7FA`;
- azul: `#087DFF`;
- ciano: `#00D7E8`;
- laranja: `#FFAD00`;
- magenta: `#FF009F`;
- violeta: `#7238FF`;
- gradiente: laranja → magenta → violeta → azul → ciano.

O gradiente será reservado ao logo, barra de assinatura, ícone PWA e raros momentos de marca. Ações rotineiras, foco, seleção e contadores usarão azul XP. O verde ficará restrito ao canal WhatsApp e a estados positivos, evitando conflito semântico.

### 3.3 Modos claro e escuro

Serão oferecidas três preferências:

- claro;
- escuro;
- seguir o sistema.

Os temas usarão tokens semânticos independentes para canvas, painéis, superfícies elevadas, texto, texto secundário, bordas, seleção, mensagens recebidas, mensagens enviadas, foco, perigo, aviso e sucesso. O escuro não será uma simples inversão do claro.

A preferência ficará no dispositivo e será aplicada antes da primeira pintura para evitar clarão e mudança de layout. A interface reagirá a alterações do tema do sistema quando a preferência escolhida for “seguir o sistema”.

## 4. Arquitetura responsiva

### 4.1 Desktop — 1200 px ou mais

- Três áreas simultâneas: conversas, histórico e inspetor do cliente.
- Lista com largura fluida definida por `clamp(320px, 23vw, 370px)`.
- Inspetor com largura definida por `clamp(280px, 20vw, 330px)`.
- Histórico ocupa o espaço restante e limita a largura dos balões para leitura confortável.
- Estados de atualização preservam os dados visíveis.

### 4.2 Tablet — 768 a 1199 px

- Duas áreas: lista e histórico.
- Dados do cliente abrem em drawer lateral acessível.
- A partir da faixa em que duas colunas não comportem conteúdo útil, a navegação passa para o modelo móvel.
- O drawer restaura foco ao controle de origem ao fechar.

### 4.3 Celular — 320 a 767 px

- Uma vista por vez: lista, conversa ou detalhes.
- Navegação integrada ao histórico do navegador e ao botão voltar do Android.
- Cabeçalho compacto com nome preservado e ações secundárias no menu “Mais”.
- Compositor considera teclado virtual e `env(safe-area-inset-bottom)`.
- Nenhuma rolagem horizontal na aplicação ou nas configurações.
- Rascunho, conversa selecionada e posição de leitura são preservados durante transições.

### 4.4 Configurações

- Usuários: tabela no desktop; cartões/lista semântica no celular.
- Classificações: lista adaptativa com cor, nome e estado, sem depender apenas da cor.
- Respostas rápidas: cartões densos, ações explícitas e diálogo responsivo.
- Diálogos em telas pequenas tornam-se painéis quase integrais, respeitando safe areas.

## 5. Componentes e responsabilidades

### 5.1 Estrutura

- `ThemeProvider`: preferência de tema e sincronização com o sistema.
- `PwaMetadata`: manifesto, ícones e metadados por plataforma.
- `AppShell`: canvas, navegação, conexão e regiões principais.
- `ConversationSidebar`: busca, filtros, paginação e atualização preservando conteúdo.
- `ThreadHeader`: identidade do contato e ações responsivas.
- `MessageTimeline`: agrupamento, balões, mídias, estados, respostas e reações.
- `MessageActions`: ações por hover/foco no desktop e menu explícito no celular.
- `MessageComposer`: texto, mídia, áudio, resposta citada e safe area.
- `ContactInspector`: dados, responsável, tipo e etiquetas.
- `ResponsiveSettingsList`: representação em tabela ou cartões conforme espaço.
- `ConnectionStatus`: reconexão sem bloquear atendimento existente.

### 5.2 Limites

O redesign não altera contratos REST, persistência, regras do WhatsApp, modelo Prisma ou processamento de webhooks. Mudanças de DTO só serão permitidas se necessárias para exibir informação já existente e deverão manter compatibilidade.

Arquivos muito extensos, especialmente o hook principal da inbox, serão divididos somente quando isso reduzir risco direto do redesign. Não haverá refatoração independente do objetivo.

## 6. Interação

**Tese de interação:** o sistema deve parecer rápido por preservar contexto, mover somente o necessário e revelar ações no momento certo.

Movimentos intencionais:

- transição curta entre lista, conversa e detalhes no celular;
- entrada e saída de drawers e diálogos com duração reduzida;
- realce temporário ao localizar, responder ou atualizar uma mensagem.

Todos respeitarão `prefers-reduced-motion`.

Regras:

- ações de mensagem aparecem no hover e no foco por teclado no desktop;
- no celular, ações secundárias ficam em menu acessível, sem exigir gesto oculto;
- arrastar para responder continua opcional, com botão equivalente sempre disponível;
- atualizações SSE não substituem conteúdo por spinner integral;
- falha de atualização mantém dados anteriores, mostra aviso e oferece repetição;
- carregamento inicial usa skeletons compatíveis com a geometria final;
- mídias preservam proporção e nunca ampliam a página horizontalmente;
- mensagens longas, links, documentos, áudios e nomes incomuns devem quebrar corretamente.

## 7. Acessibilidade

O alvo é WCAG 2.2 nível AA.

- Alvos de toque mínimos de 44 × 44 px.
- Contraste verificado em todos os tokens e nos dois temas.
- Foco visível, consistente e não encoberto por áreas fixas.
- Fluxos completos por teclado.
- Cabeçalhos, regiões, listas, tabelas e logs com semântica apropriada.
- Estados, erros e conexão anunciados com `aria-live` sem repetição excessiva.
- Foco restaurado após menus, drawers e diálogos.
- Cores acompanhadas por texto, ícone ou padrão.
- Zoom de 200% sem perda de conteúdo ou funcionalidade.
- Compatibilidade com texto ampliado e movimento reduzido.
- Controles somente com ícone terão nome acessível e tooltip visual quando útil.

## 8. PWA online e instalável

### 8.1 Objetivo

A PWA servirá como forma de instalação e abertura em janela própria. Não haverá suporte offline para atendimento.

### 8.2 Manifesto

Será criado `src/app/manifest.ts` usando `MetadataRoute.Manifest` com:

- `name`: `XP Atendimento`;
- `short_name`: `XP Atendimento`;
- `description`: central interna da XP Eletrônicos;
- `start_url`: `/conversas`;
- `scope`: `/`;
- `display`: `standalone`;
- `background_color`: preto XP;
- `theme_color`: preto XP;
- ícones de 192 e 512 px;
- versões `maskable` para Android.

O layout também fornecerá favicon, Apple Touch Icon, `appleWebApp`, viewport seguro e `theme-color` distinto para preferências clara e escura.

### 8.3 Ícones

O símbolo oficial da XP será convertido em:

- favicon vetorial ou PNG;
- 16, 32, 180, 192 e 512 px;
- ícone maskable com margem segura;
- ícone monocromático/badge quando necessário.

Os ícones serão verificados visualmente em fundos claro, escuro e recortados em círculo.

### 8.4 Cache e service worker

Não será implementado cache offline de HTML autenticado, APIs, conversas, mídias, sessões ou dados pessoais.

Para o objetivo atual, manifesto válido e HTTPS fornecem a experiência instalável. Não será adicionado service worker de cache nesta fase. Isso evita versões antigas, inconsistência com SSE e persistência involuntária de conteúdo sensível. Push notifications, background sync e atendimento offline permanecem fora do escopo.

### 8.5 Instalação

- Chrome e Edge usarão a instalação nativa do navegador.
- Safari/iOS usará “Adicionar à Tela de Início”.
- A interface poderá incluir ajuda contextual de instalação, mas não dependerá de `beforeinstallprompt`.
- A aplicação continuará operando normalmente em aba quando instalação não for suportada.

## 9. Segurança e privacidade

- Nenhum segredo ou token irá para o cliente.
- Rotas autenticadas e mídia manterão `no-store` quando aplicável.
- Tema e preferência de instalação não conterão dados pessoais.
- O logo será incorporado como asset local, sem dependência do site público da loja em execução.
- Links externos serão identificados e tratados fora do shell quando necessário.
- A PWA não armazenará conversas ou anexos para uso offline.

## 10. Erros e estados

- Login: erro claro, campos preservados e foco no resumo/campo inválido.
- Lista: skeleton somente na primeira carga; atualização silenciosa mantém itens.
- Conversa: estado vazio útil, erro com repetição e histórico preservado em falhas transitórias.
- SSE: banner discreto, reconexão automática e sincronização ao reabrir.
- Envio: pendente, enviado, entregue, lido e falha visualmente distintos e anunciáveis.
- PWA: ausência de suporte à instalação nunca bloqueia a aplicação.
- Tema: fallback para sistema quando a preferência local for inválida.

## 11. Testes e verificação

### 11.1 Automatizados

- testes de tema, persistência e preferência do sistema;
- manifesto e metadados obrigatórios;
- navegação móvel e histórico;
- preservação da lista durante atualização;
- ações de mensagem por teclado e menu móvel;
- tabela/cartões de usuários conforme breakpoint;
- foco em drawers, diálogos e menus;
- regressão dos componentes e hooks existentes.

### 11.2 Visual

Verificar ambos os temas em:

- 320 × 568;
- 390 × 844;
- 768 × 1024;
- 900 × 1100;
- 1024 × 768;
- 1280 × 800;
- 1440 × 900.

Casos obrigatórios:

- lista extensa com não lidas, fixadas, tipos e etiquetas;
- conversa vazia e conversa longa;
- textos longos, emojis, links e caracteres incomuns;
- imagem, áudio, vídeo, PDF e documento;
- resposta citada, reações e falha de envio;
- teclado virtual e safe area;
- drawer de cliente;
- todas as páginas de configuração;
- login e erros globais;
- PWA instalada em janela standalone.

### 11.3 Gate técnico

Executar, no mínimo:

- testes completos;
- lint;
- typecheck;
- build de produção;
- validação do manifesto;
- auditoria Lighthouse de PWA e acessibilidade;
- testes reais no navegador contra build de produção;
- smoke test das funções de atendimento existentes.

## 12. Implantação

1. Implementar e verificar em ambiente isolado.
2. Gerar evidências visuais dos breakpoints e temas.
3. Construir a imagem de produção.
4. Fazer backup conforme procedimento existente.
5. Publicar somente os serviços `xp-whatsapp-*`.
6. Conferir healthcheck, login, conversas, envio, SSE, configurações e manifesto.
7. Testar instalação pelo domínio HTTPS real.
8. Monitorar logs e manter rollback para a imagem anterior.

Nenhuma alteração será feita no processo, container ou diretório do site principal da XP Eletrônicos.

## 13. Fora do escopo

- funcionamento offline;
- cache offline de mensagens ou mídias;
- push notifications;
- APK, Capacitor ou publicação em lojas;
- mudança de backend ou regras do WhatsApp;
- cópia visual literal do WhatsApp;
- novos módulos de CRM não existentes.

## 14. Critérios de aceite

O trabalho será aceito quando:

1. todas as telas funcionarem entre 320 e 1440 px sem rolagem horizontal indevida;
2. desktop, tablet e celular usarem as composições aprovadas;
3. usuários forem exibidos sem tabela horizontal no celular;
4. cabeçalho e compositor funcionarem com teclado virtual e safe areas;
5. modos claro, escuro e sistema persistirem sem clarão;
6. contraste e navegação por teclado atingirem WCAG 2.2 AA;
7. atualizações não apagarem conteúdo existente;
8. manifesto e ícones permitirem instalação em modo standalone pelo domínio HTTPS;
9. nenhum conteúdo privado for disponibilizado offline;
10. testes, lint, typecheck, build e auditorias terminarem sem falhas impeditivas;
11. fluxos existentes de atendimento continuarem funcionando;
12. produção passar por smoke test e possuir rollback verificável.

## 15. Referências técnicas

- [Guia oficial de PWA do Next.js](https://nextjs.org/docs/app/guides/progressive-web-apps)
- [Estrutura de projetos no App Router](https://nextjs.org/docs/app/getting-started/project-structure)
- [Instalação de PWAs](https://web.dev/learn/pwa/installation)
- [Manifesto de aplicação web](https://web.dev/learn/pwa/web-app-manifest)
- [Modo `standalone` no manifesto](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/display)
