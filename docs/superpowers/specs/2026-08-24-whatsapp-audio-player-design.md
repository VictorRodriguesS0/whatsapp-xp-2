# Player de áudio no estilo WhatsApp — desenho aprovado

## Objetivo

Substituir o controle de áudio nativo exibido nas mensagens por um player compacto, consistente e próximo ao WhatsApp oficial. O player deve informar duração, impedir dois áudios simultâneos e oferecer velocidades `1×`, `1,5×` e `2×` para mensagens recebidas e enviadas.

## Direção visual e interação

A tese visual é de um controle operacional discreto que pertença ao próprio balão: poucos elementos, contraste herdado da mensagem e nenhuma moldura cinza do navegador.

O player terá, em uma única linha responsiva:

- botão circular de reproduzir ou pausar com alvo mínimo de 44px;
- trilho segmentado de progresso, com preenchimento proporcional e posição clicável/arrastável;
- tempo no formato `decorrido / duração`, por exemplo `0:08 / 0:37`;
- botão compacto de velocidade com os rótulos `1×`, `1,5×` e `2×`.

O trilho usa segmentos regulares apenas como linguagem visual, sem fingir representar a amplitude real do arquivo. O tempo e a posição exibidos são reais. Os controles usam as cores e o contraste do balão atual, com foco visível e sem acrescentar cartões ou badges.

Ao tocar no botão de velocidade, o ciclo é `1× → 1,5× → 2× → 1×`. A escolha é aplicada imediatamente ao áudio atual e mantida em `sessionStorage` para os próximos áudios na mesma sessão do atendente. Cada nova sessão começa em `1×`.

## Abordagem escolhida

Será criado um player React controlado, mantendo um elemento `<audio>` sem controles nativos como motor de mídia. Essa solução preserva streaming, byte ranges, codecs e segurança da rota autenticada existente, enquanto permite apresentação e comportamento uniformes.

Foram rejeitadas duas alternativas:

- manter o controle nativo e coordenar somente eventos: não garante duração nem botão de velocidade consistentes entre Chrome, Safari e navegadores móveis;
- criar uma barra global fixa: facilita a reprodução exclusiva, mas se afasta do WhatsApp e separa o controle da mensagem correspondente.

Não haverá mudança de banco, conversão de áudio ou novo endpoint. A duração será lida dos metadados do próprio arquivo pelo navegador.

## Componentes e responsabilidades

### `AudioMessagePlayer`

Componente isolado usado por `MessageMedia` quando uma mensagem de áudio está disponível. Recebe a URL autenticada e uma identidade estável da mensagem.

Responsabilidades:

- carregar apenas metadados inicialmente;
- manter estados de duração, posição, reprodução e velocidade;
- reproduzir, pausar e buscar no arquivo;
- formatar tempos sem mostrar `NaN` ou `Infinity`;
- sincronizar a posição nos eventos nativos `timeupdate`, `durationchange`, `loadedmetadata`, `play`, `pause` e `ended`;
- aplicar a preferência de velocidade atual ao elemento de áudio;
- entregar o foco e os nomes acessíveis corretos aos controles;
- liberar sua participação no coordenador ao terminar ou desmontar.

O componente não conhece mensagens, recuperação de mídia, API Meta ou armazenamento do servidor.

### Coordenador de reprodução

Um módulo cliente mantém somente a referência do elemento de áudio ativo. Antes de um elemento iniciar, ele reivindica a reprodução; o coordenador pausa o elemento anterior se for diferente. Ao pausar, terminar ou desmontar, o componente libera a referência somente se ainda for o proprietário.

O mesmo coordenador será conectado à prévia da gravação no compositor. Assim, iniciar uma mensagem pausa a prévia e iniciar a prévia pausa qualquer mensagem, garantindo uma única fonte de áudio em toda a aplicação.

O coordenador não persiste estado, não acessa o DOM por seletores globais e não controla vídeos.

### Preferência de velocidade

Um pequeno módulo cliente valida e lê `sessionStorage` com chave versionada. Somente `1`, `1.5` e `2` são aceitos. Valores ausentes, corrompidos ou acesso bloqueado ao armazenamento resultam com segurança em `1×`.

A alteração em um player grava a preferência e emite um evento local da aplicação. Players montados passam a conhecer a nova preferência, mas somente o áudio ativo muda de velocidade imediatamente; os demais a aplicarão ao serem reproduzidos.

## Fluxo de reprodução

1. O balão disponível monta `AudioMessagePlayer` com `/api/media/:id` ou com a URL temporária já usada por uma mensagem otimista.
2. O navegador lê os metadados e o componente mostra `0:00 / duração`.
3. O atendente inicia o áudio.
4. O player reivindica o coordenador, que pausa qualquer áudio anterior.
5. O elemento recebe a velocidade preferida e inicia; os eventos nativos atualizam ícone, tempo e trilho.
6. Buscar no trilho altera `currentTime` dentro dos limites válidos.
7. Ao terminar, o player volta ao estado pausado, mantém a posição final e libera o coordenador.
8. Uma nova reprodução do áudio terminado reinicia em zero.

## Estados e falhas

- Antes dos metadados, a duração aparece como `—:—` e os controles continuam estáveis, sem deslocar o balão.
- Duração inválida ou infinita permanece `—:—`; o botão de busca fica desabilitado, mas reproduzir e velocidade continuam disponíveis.
- Se `play()` for rejeitado pelo navegador, o ícone retorna para reproduzir e um texto curto e sanitizado informa que não foi possível iniciar o áudio.
- Erros de carregamento usam a mensagem genérica `Não foi possível reproduzir este áudio.` e não expõem resposta HTTP, caminho ou detalhe de codec.
- Mensagens pendentes, em recuperação ou falhas continuam usando os estados atuais de `MessageMedia`; o novo player só aparece quando há uma fonte reproduzível.
- Trocar de conversa ou reconciliar a identidade da mídia pausa e libera o áudio desmontado.

## Acessibilidade e dispositivos móveis

- Reproduzir/pausar e velocidade serão botões nativos com nomes que descrevem o estado e a próxima ação.
- O trilho será um `input[type=range]` acessível, com valor textual no formato de tempo.
- Todos os alvos interativos terão ao menos 44px na dimensão de toque e foco visível.
- O tempo usará números tabulares para evitar saltos de largura.
- O layout poderá reduzir o trilho antes de comprimir botões ou texto, sem rolagem horizontal no balão.
- Mudanças de tempo frequentes não serão anunciadas automaticamente por leitor de tela; isso evita ruído contínuo.
- Animações respeitarão `prefers-reduced-motion`.

## Testes

O desenvolvimento seguirá ciclos RED, GREEN e REFACTOR.

- Formatação cobre zero, minutos, horas, duração desconhecida e valores inválidos.
- Metadados válidos mostram a duração real; metadados inválidos preservam o fallback.
- Reproduzir e pausar refletem o estado real do elemento, inclusive rejeição de `play()`.
- Iniciar um segundo áudio pausa o primeiro, e iniciar a prévia da gravação também participa da exclusividade.
- O botão percorre exatamente `1×`, `1,5×`, `2×`; a preferência é persistida durante a sessão, validada e aplicada aos próximos áudios.
- Busca pelo mouse, toque e teclado respeita zero e duração máxima.
- `ended`, troca de fonte e desmontagem limpam corretamente o coordenador.
- Mensagens recebidas, enviadas, otimistas e reconciliadas mantêm a URL e o foco esperados.
- Testes de `MessageMedia` preservam recuperação automática, retry manual e demais tipos de mídia.
- A verificação autenticada no navegador usa ao menos dois áudios reais, confirma duração, velocidade, busca e impossibilidade de reprodução simultânea em desktop e celular.

## Implantação e integração paralela

Antes do deploy serão comparadas novamente a revisão ativa da KVM, a candidata e todas as worktrees. Mudanças paralelas concluídas que façam parte da produção serão integradas; alterações incompletas não serão incorporadas parcialmente nem sobrescritas.

O build produzirá uma imagem imutável da revisão exata. O backup validado será criado antes da troca. Somente o container da aplicação será recriado; banco, gateway e demais sistemas da KVM permanecerão intactos. Depois do deploy serão verificados saúde, migrations, reinícios, logs, rota autenticada e o fluxo real no navegador.

## Fora do escopo

- Transcrição, download, encaminhamento ou resposta a áudio.
- Geração de forma de onda real no cliente ou servidor.
- Velocidades diferentes de `1×`, `1,5×` e `2×`.
- Persistir a preferência entre sessões, usuários ou dispositivos.
- Sincronizar posição de reprodução entre usuários.
- Alterar codecs, download de mídia ou integração com a Meta.
