# Evolução operacional da caixa de atendimento

**Data:** 21 de agosto de 2026

**Status:** aprovado pelo usuário

**Aplicação:** XP Atendimento

**Produção:** `https://whatsapp.xpeletronicos.com`

## Objetivo

Evoluir a caixa compartilhada da XP Eletrônicos para que leitura, necessidade de resposta, classificação e retorno ao cliente tenham uma única verdade para toda a equipe. A mesma evolução deve melhorar a apresentação dos contatos e das mídias, acrescentar lembretes duráveis, permitir respostas rápidas corporativas e continuar respeitando integralmente as regras da WhatsApp Business Platform.

O trabalho será publicado em fases compatíveis. A primeira fase corrige o estado operacional compartilhado e a recuperação de mídias; as fases seguintes preservam a ordem escolhida pelo usuário: mídia e identidade, organização e retorno, e produtividade.

## Decisões aprovadas

- A situação de leitura e resposta será compartilhada por toda a equipe.
- Abrir uma conversa limpa o estado não lido para todos; responder limpa o estado aguardando resposta para todos.
- A ação manual **Marcar como não lida** também será compartilhada.
- O histórico continuará identificando quem leu, respondeu, marcou como não lida ou operou um lembrete.
- O visual seguirá a direção **A — Operacional equilibrado**.
- O nome recebido da Meta será preservado e poderá existir um nome preferencial editável.
- O telefone será exibido com máscara brasileira, mantendo o identificador canônico sem formatação no banco.
- Não será prometida foto pessoal do WhatsApp, pois esse dado não é oferecido pela Cloud API.
- Cada contato terá um tipo principal e poderá ter várias etiquetas opcionais.
- A cor das iniciais representará o tipo principal; as etiquetas sempre terão texto, não apenas cor.
- Imagens e vídeos poderão ser abertos em um visualizador acessível em tela cheia e baixados por qualquer usuário autenticado.
- A identidade usará a imagem fornecida pelo usuário, com uma versão completa e um favicon simplificado; ambas terão contorno verde.
- Uma conversa ficará atrasada quando a última mensagem relevante for do cliente e transcorrerem 30 minutos úteis sem resposta.
- O horário operacional é terça-feira a domingo, das 9h às 17h30, no fuso de Brasília; segunda-feira é fechada e não haverá calendário de feriados.
- Lembretes serão compartilhados, terão responsável e observação, sobreviverão a reinícios e nunca enviarão mensagens automaticamente.
- Qualquer atendente poderá concluir ou adiar um lembrete, preservando responsável original e autoria da ação.
- Respostas rápidas serão compartilhadas pela empresa e administradas somente por administradores.
- A primeira versão de respostas rápidas aceitará somente texto e variáveis seguras.
- Respostas rápidas internas e templates aprovados da Meta serão recursos separados.
- Fora da janela de atendimento da Meta, texto livre será bloqueado e somente templates aprovados poderão ser enviados.

## Estado operacional compartilhado

### Conceitos distintos

A interface não deve mais misturar leitura com necessidade de resposta:

- **Não lida:** há mensagem do cliente posterior ao cursor coletivo de leitura, ou a conversa foi marcada manualmente como não lida.
- **Aguardando resposta:** a última mensagem relevante na ordenação estável da conversa é de entrada.
- **Respondida:** existe mensagem de saída posterior à última mensagem relevante do cliente.
- **Atrasada:** está aguardando resposta e alcançou o prazo de 30 minutos úteis.

Confirmações de entrega, leitura, eventos técnicos da Meta e alterações administrativas não contam como mensagens relevantes para esse cálculo.

### Leitura coletiva sem perder auditoria

O modelo atual `ConversationRead`, por usuário, será mantido para auditoria e para registrar a última leitura de cada pessoa. A conversa ganhará um cursor coletivo de leitura composto por `teamLastReadMessageId` e `teamLastReadAt`.

Ao abrir uma conversa, o cliente envia o ID da última mensagem realmente visível. A transação:

1. valida que a mensagem pertence à conversa;
2. avança monotonicamente o cursor individual do ator;
3. avança monotonicamente o cursor coletivo;
4. limpa a marcação manual de não lida somente se ela ainda for a versão observada pelo cliente;
5. grava um evento de auditoria;
6. publica uma invalidação em tempo real.

A ordenação usa a fronteira estável já adotada pelo sistema, `(externalTimestamp, id)`. Uma mensagem que chegar durante uma requisição de leitura permanece não lida, porque o cliente informa a fronteira exata que viu.

### Marcação manual de não lida

Marcar como não lida não fará o cursor de leitura retroceder. A conversa terá um marcador coletivo separado, com instante, ator e versão. Isso permite exibir o indicador sem falsificar a contagem histórica de mensagens.

Abrir novamente a conversa limpa o marcador para toda a equipe. Se alguém precisar de um acompanhamento pessoal ou futuro, deve usar um lembrete, e não o estado de leitura.

### Necessidade de resposta

A conversa terá `awaitingResponseSince` e `responseDueAt`, ambos anuláveis. Sempre que uma mensagem relevante for persistida, a mesma transação bloqueia a conversa, determina a última mensagem pela fronteira estável e materializa o estado:

- última mensagem de entrada: inicia `awaitingResponseSince` e calcula `responseDueAt` somente quando a conversa ainda não aguardava resposta; mensagens adicionais do cliente preservam o primeiro prazo pendente;
- última mensagem de saída: limpa os dois campos;
- mensagem antiga ou callback fora de ordem: não pode regredir o estado mais recente.

O usuário responsável pela mensagem de saída já fica registrado na própria mensagem. Eventos adicionais de auditoria registrarão mudanças manuais de leitura e operação de lembretes.

### Migração

O cursor coletivo inicial será o ponto de leitura mais avançado existente entre todos os usuários para cada conversa. Isso evita que mensagens já tratadas reapareçam como pendentes após a publicação. As novas colunas serão aditivas e a aplicação anterior continuará capaz de executar durante um rollback de imagem.

## Contatos, tipos e etiquetas

### Identidade do contato

O contato continuará usando o `wa_id` como identificador canônico. Serão mantidos separadamente:

- `profileName`: último nome de perfil recebido da Meta;
- `preferredName`: nome preferencial opcional, editado pela equipe;
- número canônico somente com dígitos;
- apresentação formatada calculada no servidor/cliente.

A interface usa `preferredName`, depois `profileName` e, por último, o telefone formatado. Para um número brasileiro válido, a apresentação segue `+55 (DD) 9XXXX-XXXX` ou `+55 (DD) XXXX-XXXX`; valores que não puderem ser classificados são exibidos com formatação conservadora, sem alterar o valor canônico.

### Tipo principal

Cada contato poderá ter um tipo principal. A instalação inicial terá:

- Cliente;
- Interessado;
- Fornecedor/Parceiro;
- Não cliente.

Administradores poderão criar, renomear, reordenar, alterar a cor e desativar tipos. Um tipo em uso não será apagado fisicamente; ele poderá ser desativado e continuará legível no histórico. O tipo define a cor de fundo/contorno das iniciais, mas a interface sempre mostra também o nome textual quando a classificação é relevante.

### Etiquetas

Etiquetas são adicionais e muitos-para-muitos. Administradores poderão gerenciar nome, cor, ordem e situação ativa; atendentes poderão aplicá-las ou removê-las dos contatos. Exemplos não obrigatórios incluem VIP, Orçamento, Pós-venda e Garantia.

Filtros aceitarão tipo, uma ou mais etiquetas, responsável, não lida, aguardando resposta, atrasada e lembrete. Busca por nome continuará incluindo nome original, nome preferencial e telefone canônico.

## Identidade visual e apresentação

### Direção visual

A lista permanece compacta o suficiente para atendimento, sem transformar cada conversa em um cartão grande. Cada item apresenta:

- bolinha com iniciais e cor do tipo principal;
- nome resolvido;
- telefone mascarado em linha secundária;
- prévia da última mensagem;
- responsável;
- indicadores de não lida, atraso, lembrete e etiquetas sem depender exclusivamente de cor.

O cabeçalho da conversa repete nome, telefone, tipo e etiquetas. O painel de dados do cliente permite editar nome preferencial, tipo e etiquetas de acordo com as permissões aprovadas.

### Marca da XP

A imagem fornecida pelo usuário será incorporada como fonte de marca, não referenciada a partir de um diretório temporário. Serão gerados ativos versionados:

- logo completa para login e superfícies com espaço suficiente;
- versão simplificada para favicon e ícones pequenos;
- tamanhos adequados para navegador e atalhos da aplicação.

O fundo preto e o gradiente original serão preservados. Um contorno verde externo será acrescentado à logo completa; no favicon ele será mais forte para permanecer legível. A simplificação manterá a identidade da XP sem copiar o símbolo oficial do WhatsApp.

## Mídias

### Visualizador de imagem e vídeo

Miniaturas de imagens e vídeos serão controles acessíveis. O visualizador em tela cheia permitirá:

- ampliar, reduzir e mover imagens;
- navegar entre imagens e vídeos disponíveis na conversa atual;
- reproduzir vídeo com controles nativos;
- baixar o arquivo;
- fechar por botão, `Esc` ou interação fora do conteúdo quando apropriado;
- devolver foco ao elemento que abriu o visualizador.

Os arquivos continuam servidos por rotas autenticadas. O download definirá nome seguro e `Content-Disposition`; URLs temporárias e listeners serão liberados ao fechar ou trocar de conversa. Conteúdo ainda indisponível nunca será aberto como se estivesse pronto.

### Áudio recebido e recuperação automática

O problema observado em produção foi uma mídia recebida válida que permaneceu pendente até nova tentativa/refetch. O desenho preserva a validação forte existente e torna a transição visível e automática:

1. o webhook cria a mensagem e o objeto de mídia em estado pendente;
2. a persistência é agendada fora da resposta do webhook, com claim, lease, limite e espera progressiva;
3. clientes que exibem uma mídia pendente solicitam recuperação somente quando `nextAttemptAt` permitir;
4. o servidor combina requisições concorrentes por mídia, mantendo o limitador global e por usuário;
5. ao ficar disponível, o servidor publica `media.updated` e todas as sessões refazem a mensagem afetada;
6. a interface troca o indicador de carregamento pelo player habilitado sem recarregar a página.

Falhas transitórias permanecem pendentes até o teto já definido. Falha permanente ou esgotamento apresenta mensagem pública e botão **Tentar novamente**, sem repetição infinita. MIME é canonicalizado ao tipo-base, mas estrutura, tamanho, hash e conteúdo mágico continuam obrigatórios.

Estados do áudio:

- **Baixando:** spinner/status, sem player falso em `0:00`;
- **Disponível:** player habilitado e duração legível;
- **Falha temporária:** tentativa automática limitada;
- **Falha persistente:** retry manual seguro.

## SLA de atendimento

### Calendário fixo

O calendário usa `America/Sao_Paulo`:

- terça-feira a domingo: 09:00–17:30;
- segunda-feira: fechado;
- sem exceções de feriados nesta versão.

O prazo é de 30 minutos úteis. Mensagem recebida fora do expediente começa a contar na próxima abertura. Se o prazo atravessar o fechamento, o saldo restante continua na próxima abertura. Exemplo: uma mensagem às 17:15 de domingo usa 15 minutos no domingo e vence às 09:15 de terça-feira.

Mensagens adicionais do cliente antes de uma resposta não reiniciam nem adiam o prazo: a referência continua sendo a primeira mensagem ainda não respondida.

O servidor calcula `responseDueAt`; o navegador apenas apresenta e reage ao instante entregue. Mudanças de relógio local não alteram a verdade do banco.

### Priorização

Sem busca explícita, a lista seguirá grupos estáveis:

1. lembretes vencidos;
2. conversas atrasadas aguardando resposta;
3. conversas não lidas;
4. demais conversas por atividade recente.

Dentro de cada grupo, a ordenação usa o instante relevante e um desempate estável. Atraso terá texto/ícone e contraste acessível, não somente uma borda colorida.

## Lembretes

### Modelo durável

Um lembrete terá:

- conversa;
- data/hora em `timestamptz`;
- observação obrigatória;
- responsável ativo;
- criador;
- situação `PENDING`, `COMPLETED` ou `CANCELLED`;
- datas e atores de conclusão/cancelamento.

Uma tabela de eventos registrará criação, adiamento, conclusão e cancelamento, incluindo valor anterior e novo quando houver mudança. Adiar atualiza o lembrete e grava o evento na mesma transação.

### Experiência

O criador é o responsável inicial por padrão, mas pode escolher outro atendente ativo. Todos podem ver, concluir, adiar ou cancelar. Quando vencer:

- a conversa sobe para o grupo prioritário;
- o responsável recebe ênfase visual;
- as outras sessões também recebem a atualização;
- a observação aparece junto da ação esperada.

O vencimento é derivado de `dueAt <= now()` no servidor, portanto sobrevive a reinícios sem depender de um job em memória. Para atualizar exatamente no instante, o cliente agenda um timer local e mantém uma sincronização periódica leve; ao reconectar ou acordar, refaz o estado autoritativo.

### Envio humano e regras da Meta

Lembretes nunca disparam mensagens. O atendente abre a conversa, revisa a observação e confirma o conteúdo. Dentro da janela de atendimento da Meta poderá usar texto livre ou resposta rápida. Fora dela, o compositor bloqueia texto livre e abre o seletor de templates aprovados.

## Respostas rápidas e templates

### Biblioteca corporativa

Somente administradores gerenciam respostas rápidas. Cada registro terá:

- atalho único normalizado, como `/horario`;
- título;
- corpo de texto;
- posição;
- situação ativa;
- criador e último editor;
- datas de criação e alteração.

Atalhos aceitam letras minúsculas sem acento, números, hífen e sublinhado, com limites explícitos. O corpo respeita o teto da mensagem de texto e somente estas variáveis iniciais:

- `{{nome_cliente}}`;
- `{{nome_atendente}}`;
- `{{telefone_loja}}`.

O servidor também valida e resolve as variáveis. Valores ausentes produzem uma mensagem clara antes do envio; nenhum placeholder desconhecido é enviado literalmente por acidente.

Ao digitar `/` no início do compositor ou depois de espaço, uma paleta pesquisável filtra atalho, título e conteúdo. Ela funciona por teclado, insere o texto no compositor e permite edição antes do envio. Respostas pessoais, anexos embutidos e envio automático ficam fora desta versão.

### Templates da Meta

Respostas rápidas locais não são equivalentes aos templates da WhatsApp Business Platform e não tentam importar as respostas rápidas do aplicativo WhatsApp Business.

O servidor poderá sincronizar o catálogo de templates aprovados da WABA usando as credenciais já mantidas no backend. Metadados necessários — nome, idioma, categoria, estado, componentes e instante de sincronização — poderão ser armazenados em cache para disponibilidade e busca, mas a Meta continua sendo a autoridade final. O token nunca é enviado ao navegador.

Quando a última mensagem do cliente estiver fora da janela de 24 horas:

- texto livre e respostas rápidas locais ficam desabilitados;
- a interface explica a regra;
- somente templates com estado aprovado são oferecidos;
- variáveis obrigatórias são validadas antes do envio;
- rejeição da Meta mantém estado conservador e oferece tentativa segura quando aplicável.

## APIs e componentes

As rotas existentes manterão envelopes e autenticação. Alterações e adições previstas:

- `POST /api/conversations/[id]/read`: passa a avançar leitura individual e coletiva;
- `POST /api/conversations/[id]/unread`: marca a conversa coletivamente como não lida;
- `PATCH /api/contacts/[id]`: nome preferencial e tipo principal;
- rotas de aplicação/remoção de etiquetas no contato;
- CRUD administrativo de tipos e etiquetas;
- CRUD de lembretes e ações de adiar/concluir/cancelar;
- CRUD administrativo de respostas rápidas;
- listagem e sincronização autenticada de templates Meta;
- ação autenticada e limitada de recuperação de mídia pendente.

O contrato de conversa será ampliado com estado coletivo, tipo, etiquetas, prazo, lembrete prioritário e revisão/versão. DTOs nunca expõem tokens, caminhos locais ou razões internas do provider.

Componentes principais:

- lista de conversas com grupos, indicadores e filtros;
- cabeçalho e painel do contato editáveis;
- visualizador de mídia;
- player de áudio com máquina de estados;
- editor/lista de lembretes;
- paleta de respostas rápidas;
- seletor de templates Meta;
- telas administrativas de tipos, etiquetas e respostas rápidas.

## Tempo real e concorrência

O SSE continuará singleton por sessão de navegador. Novos eventos transportam apenas tipo, IDs e revisão necessária para invalidação:

- `conversation.updated`;
- `message.created` e `message.updated`;
- `media.updated`;
- `reminder.updated`;
- `contact.updated`;
- `settings.updated`.

O cliente não trata o payload SSE como fonte definitiva: ele concilia ou refaz o recurso. Números de revisão/guardas impedem que uma resposta HTTP antiga sobrescreva um evento mais recente.

Operações compartilhadas usam transações, bloqueio/CAS e idempotência. Em particular:

- leitura nunca retrocede;
- mensagem nova durante leitura continua não lida;
- resposta concorrente com nova entrada respeita a última mensagem estável;
- dois usuários adiando/concluindo o mesmo lembrete não produzem dois estados finais;
- edição de tipo/etiqueta desativada não apaga vínculos históricos;
- retries de mídia continuam limitados e combinados.

## Segurança, privacidade e auditoria

- Todas as mutações exigem sessão e proteção de mesma origem.
- Rotas administrativas exigem papel `ADMIN` no servidor.
- IDs, cores, nomes, notas e textos passam por schema, limites e normalização.
- Observações de lembrete não entram em logs de aplicação.
- Downloads usam autorização da conversa e nomes de arquivo seguros.
- Tokens e respostas brutas da Meta permanecem no servidor e são redigidos nos erros.
- A interface mostra mensagens públicas em português, sem stack, Graph payload ou caminho local.
- Eventos de auditoria relevantes identificam ator, ação, entidade e instante, evitando duplicar conteúdo sensível desnecessário.
- Dados recebidos da Meta serão usados somente para a operação de atendimento correspondente.

## Acessibilidade e responsividade

- Alvos de ação terão no mínimo 44 px.
- Estados não dependerão somente de cor.
- Paletas, filtros, diálogos e visualizador funcionarão por teclado.
- Foco será restaurado após fechar sobreposições.
- Atualizações de gravação/mídia/lembrete usarão regiões de status sem anunciar repetidamente cada sincronização.
- `prefers-reduced-motion` será respeitado.
- Os fluxos serão verificados em 1440×900, 900×1100 e 390×844, sem overflow horizontal.

## Erros e recuperação

- Falhas de rede mantêm a ação recuperável e não fingem sucesso.
- Falhas transitórias da Meta usam política limitada de retry e espera progressiva.
- Resultados de entrega incertos permanecem conservadores e não permitem reenvio cego.
- Falhas permanentes de mídia param no teto e oferecem intervenção explícita.
- SSE offline exibe o banner atual; reconexão executa sincronização completa.
- Lembretes e SLA são recalculados do banco depois de reinício ou reconexão.
- Respostas rápidas ou templates desativados entre seleção e envio são revalidados no servidor.

## Fases de entrega

### Fase 0 — correção operacional

- cursor coletivo e migração;
- estado compartilhado aguardando resposta/respondida;
- marcar como não lida compartilhado;
- SSE entre múltiplos usuários;
- recuperação automática e atualização do áudio recebido.

### Fase 1 — mídia e identidade

- nome preferencial e telefone formatado;
- tipos, etiquetas e cores das iniciais;
- visualizador e download de imagem/vídeo;
- logo completa e favicon simplificado.

### Fase 2 — organização e retorno

- SLA de 30 minutos úteis;
- grupos e filtros da fila;
- lembretes duráveis, observação, responsável e histórico.

### Fase 3 — produtividade e Meta

- respostas rápidas corporativas com `/`;
- variáveis seguras;
- catálogo de templates aprovados;
- bloqueio de texto livre fora da janela e envio por template.

Cada fase usa migrações aditivas, imagem Docker imutável e publicação app-only pela definição canônica da KVM. Antes de qualquer migração haverá backup validado. Health, login, webhook, duas sessões e logs serão verificados; falha aciona rollback da imagem sem tocar nos demais sistemas da KVM.

## Testes e critérios de aceitação

### Estado compartilhado

- dois usuários veem a mesma contagem e situação;
- leitura de um usuário limpa o indicador para o outro em tempo real;
- resposta de qualquer usuário limpa aguardando resposta para todos;
- mensagem concorrente não é marcada como lida por engano;
- marcação manual é coletiva e limpa ao abrir;
- migração não faz conversas tratadas reaparecerem.

### Contato e interface

- fallback `preferredName` → `profileName` → telefone;
- máscara brasileira sem alterar `wa_id`;
- tipos e etiquetas filtráveis, com desativação segura;
- estados distinguíveis sem cor;
- favicon legível nos tamanhos suportados;
- fluxos acessíveis por teclado e nos três viewports.

### Mídia

- imagem e vídeo abrem, navegam, baixam e restauram foco;
- mídia de outra conversa/usuário não é acessível sem autorização;
- áudio pendente mostra carregamento, não player inerte;
- recuperação atualiza duas sessões sem reload;
- concorrência produz uma única persistência;
- falha permanente para no teto e permite retry manual.

### SLA e lembretes

- 30 minutos dentro do expediente;
- mensagens sucessivas do cliente não reiniciam o prazo;
- pausa no fechamento e em toda segunda-feira;
- mensagem fora do horário começa na próxima abertura;
- resposta concorrente encerra o SLA corretamente;
- lembrete vence e sobe na fila sem job volátil;
- reinício preserva lembrete;
- adiamento/conclusão concorrente tem um único resultado e auditoria.

### Respostas rápidas e Meta

- busca e inserção por `/` usando teclado;
- variáveis conhecidas resolvidas e desconhecidas recusadas;
- somente administrador gerencia a biblioteca;
- resposta rápida desativada é rejeitada no envio;
- texto livre é bloqueado fora da janela;
- somente template aprovado é oferecido e enviado;
- nenhuma credencial ou resposta bruta da Meta chega ao cliente/log.

### Gates por release

- suíte unitária completa;
- PostgreSQL real e testes de concorrência;
- lint, TypeScript e Prisma validate/generate;
- build standalone e auditoria de dependências;
- imagem Linux não privilegiada e health check;
- backup e restauração validados quando houver migração/mídia nova;
- QA público em desktop, tablet e celular;
- observação de logs e ausência de 5xx após publicação.

## Fora de escopo

- obtenção da foto pessoal do contato pela Cloud API;
- importação/sincronização de etiquetas ou respostas rápidas locais do aplicativo WhatsApp Business;
- respostas rápidas pessoais;
- anexos em respostas rápidas;
- envio automático de lembretes;
- calendário de feriados e exceções;
- alteração das quatro categorias de mensagens definidas pela Meta;
- escala horizontal dos limitadores/processamento nesta topologia de instância única;
- reconhecimento automático de cliente por dados externos não autorizados.

## Referências

- [Meta — exemplos oficiais da WhatsApp Cloud API](https://github.com/fbsamples/whatsapp-api-examples)
- [Meta — especificação OpenAPI da Business Messaging API](https://github.com/facebook/openapi)
- [WhatsApp Business Platform — recursos e categorias de mensagens](https://business.whatsapp.com/products/business-platform-features)
- [WhatsApp Business Policy](https://business.whatsapp.com/policy)
