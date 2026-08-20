# Gravação de áudio no atendimento

**Data:** 20 de agosto de 2026  
**Status:** aprovado pelo usuário  
**Aplicação:** XP Atendimento

## Objetivo

Permitir que um atendente grave, ouça e envie uma mensagem de áudio diretamente no compositor da conversa, usando o microfone do computador ou celular. O áudio final deve ser compatível com a WhatsApp Cloud API e percorrer o mesmo fluxo seguro e idempotente já usado pelas demais mídias.

## Decisões aprovadas

- O atendente toca uma vez para iniciar e novamente para parar.
- A gravação não é enviada automaticamente: primeiro aparece uma prévia para ouvir, apagar ou enviar.
- A duração máxima é de cinco minutos.
- O navegador captura no formato nativo disponível e o servidor converte para OGG/Opus mono com FFmpeg.
- Áudio gravado não aceita legenda.
- Não haverá pausa, edição, corte, waveform nem múltiplas gravações simultâneas neste escopo.

## Experiência do atendente

### Compositor em repouso

O botão de microfone aparece quando não há texto nem anexo selecionado. Ao existir texto, permanece o botão de envio atual. O botão de anexo continua disponível para enviar um arquivo de áudio já existente.

O clique no microfone é a única ação que solicita `getUserMedia`; a aplicação nunca pede acesso ao microfone ao carregar a página.

### Estados da gravação

O compositor terá uma máquina de estados explícita:

1. `idle`: texto, anexo e microfone disponíveis conforme as regras atuais;
2. `requesting`: aguardando a permissão do navegador, com ação bloqueada contra cliques repetidos;
3. `recording`: indicador vermelho, cronômetro, **Cancelar** e **Parar**;
4. `preview`: player nativo, duração, **Apagar** e **Enviar**;
5. `sending`: controles desabilitados enquanto a requisição está em andamento;
6. `error`: mensagem pública em português e retorno seguro a `idle` ou `preview`, conforme ainda exista uma gravação recuperável.

O cronômetro deriva do instante de início, em vez de acumular ticks, para não se desviar quando a aba perde prioridade. Aos cinco minutos a aplicação chama `stop()` automaticamente.

### Cancelamento e limpeza

Cancelar, trocar de conversa, fechar a tela ou desmontar o compositor deve:

- parar todas as trilhas do `MediaStream`;
- parar ou descartar o `MediaRecorder` sem enviar;
- cancelar timers e listeners;
- revogar URLs de prévia;
- ignorar callbacks tardios de uma gravação anterior.

Depois de parar, as trilhas do microfone são desligadas antes mesmo de o atendente decidir enviar ou apagar a prévia.

### Acessibilidade e responsividade

Todos os controles terão nome acessível e área mínima de 44 px. Mudanças como “Gravando”, “Gravação pronta” e falhas serão anunciadas por uma região de status. Cancelar ou apagar devolve o foco ao botão de microfone; parar leva o foco à prévia; enviar mantém o foco no compositor.

O mesmo arranjo deve funcionar em 1440×900, 900×1100 e 390×844 sem overflow horizontal. A prévia usa o elemento `<audio controls>` e respeita `prefers-reduced-motion`.

## Captura no navegador

Um hook isolado, `useAudioRecorder`, será responsável apenas por permissão, captura, tempo, blob, prévia e cleanup. O componente visual não acessará diretamente `navigator.mediaDevices` nem `MediaRecorder`.

O hook consultará `MediaRecorder.isTypeSupported` nesta ordem: `audio/webm;codecs=opus`, `audio/ogg;codecs=opus` e `audio/mp4`. Se nenhum deles for anunciado, usará o formato padrão somente quando o `Blob` resultante declarar `audio/webm`, `audio/ogg` ou `audio/mp4`; qualquer outro resultado será recusado localmente. O tipo efetivamente retornado pelo `MediaRecorder` será preservado no `File`; a aplicação não confiará somente na extensão. A captura solicitará `audioBitsPerSecond: 32000`, adequada para voz e muito abaixo do limite de 16 MB em cinco minutos.

Se `getUserMedia` ou `MediaRecorder` não estiver disponível, o microfone ficará indisponível com uma explicação curta; anexar um áudio existente continuará funcionando.

Erros públicos previstos:

- permissão negada: “Permita o acesso ao microfone para gravar áudio.”;
- microfone ausente ou ocupado: “Não foi possível usar o microfone.”;
- navegador incompatível: “Este navegador não permite gravar áudio. Você ainda pode anexar um arquivo.”;
- captura interrompida: “A gravação foi interrompida. Tente novamente.”;
- limite atingido: a gravação para e entra em prévia, sem ser enviada automaticamente.

## API dedicada de gravações

Será criada a rota autenticada `POST /api/conversations/[id]/recordings`, separada do upload comum. A separação impede que formatos brutos de navegador, como WebM, sejam aceitos como anexos comuns ou encaminhados por engano à Meta.

A rota aplicará, nesta ordem:

1. proteção de mesma origem;
2. autenticação e conversa válida;
3. limite de concorrência de uma conversão por usuário e duas no processo;
4. janela deslizante de dez tentativas de conversão por usuário a cada dez minutos, aplicada antes do multipart, para evitar saturação contínua;
5. leitura multipart por streaming, com teto de 16 MB;
6. allowlist dos tipos brutos produzidos pelos navegadores suportados;
7. inspeção e conversão em arquivos temporários privados;
8. validação do OGG/Opus resultante;
9. chamada do serviço existente de envio com `type: AUDIO` e o mesmo `clientRequestId`;
10. limpeza em `finally` de todos os temporários que não passaram à custódia do armazenamento definitivo.

O endpoint retorna o mesmo envelope e `MessageDto` usados pela rota de mensagens. Não será necessária migração de banco.

## Conversão segura

FFmpeg e FFprobe serão instalados na imagem de produção e executados diretamente com `spawn`, nunca por shell. Caminhos e nomes serão UUIDs criados pelo servidor; nenhum trecho do nome enviado pelo usuário entra nos argumentos como opção. FFprobe terá timeout de 10 segundos, FFmpeg de 60 segundos e cada processo poderá acumular no máximo 8 KiB de diagnóstico antes de ser encerrado.

Antes da conversão, FFprobe verifica que há uma faixa de áudio e que a duração é maior que zero e menor ou igual a 300 segundos. O processo tem tempo limite curto e saída de diagnóstico limitada. Em seguida, FFmpeg produz:

- contêiner OGG;
- codec Opus;
- um canal;
- 48 kHz;
- aproximadamente 24 kbit/s com perfil de voz;
- no máximo 300 segundos;
- metadados removidos.

O resultado será validado novamente por tamanho, estrutura OGG e cabeçalho Opus. O MIME canônico será `audio/ogg; codecs=opus`; aliases existentes de áudio OGG/Opus serão normalizados para esse valor antes do upload à Meta. A saída também permanece limitada a 16 MB.

O subprocesso roda como o mesmo usuário não privilegiado UID 1001 da aplicação. Falha, timeout, sinal ou saída inválida são tratados como erro local recuperável, sem criar uma mensagem incompleta.

## Persistência, idempotência e repetição

O cliente cria um único `clientRequestId` quando a gravação entra em prévia e o reutiliza em toda tentativa daquela gravação.

Se a conversão falhar antes de existir uma mensagem, o blob bruto e a prévia permanecem no cliente para nova tentativa. Nenhuma linha ou mídia parcial é persistida.

Depois da conversão, o serviço atual assume o fluxo:

- criação idempotente da mensagem `AUDIO`;
- armazenamento exclusivo e hash do arquivo convertido;
- upload e envio pelo provider;
- publicação SSE;
- estado operacional conservador para resultados incertos.

Se a falha ocorrer depois que o áudio convertido foi persistido, a repetição usa a rota atual de retry e nunca exige nova gravação. Se a resposta HTTP se perder, a reconciliação por `clientRequestId` elimina duplicatas como já ocorre com as demais mídias.

## Docker, operação e HTTPS

A imagem Docker incluirá FFmpeg/FFprobe na etapa de runtime e um smoke test confirmará sua presença. A gravação por microfone exige contexto seguro no navegador: `localhost` é aceito no desenvolvimento e a produção depende do HTTPS do domínio `whatsapp.xpeletronicos.com`, já previsto no Nginx/Certbot.

O deployment continua de instância única. Os limites de frequência e concorrência são locais ao processo, coerentes com essa topologia; qualquer futura escala horizontal exigirá mover esses controles para um coordenador compartilhado.

Backups não incluem arquivos temporários de conversão. Apenas o OGG/Opus final, já anexado a um `MediaObject`, entra no volume persistente e no backup validado.

## Testes e evidências

### Hook e componente

- suporte e ausência das APIs do navegador;
- permissão concedida e negada;
- proteção contra início duplicado;
- cronômetro sem drift e parada automática em cinco minutos;
- parar, cancelar, apagar e gravar novamente;
- troca de conversa e unmount com tracks/timers/URLs liberados;
- prévia acessível e envio sem legenda;
- falha de rede preservando a gravação para retry;
- foco e anúncios de status por teclado.

### Servidor

- autenticação, mesma origem e UUIDs inválidos;
- multipart malformado, tipo fora da allowlist e mais de 16 MB;
- limite de frequência e concorrência;
- FFprobe sem áudio, duração zero ou acima de cinco minutos;
- timeout, crash e diagnóstico não vazado;
- comando sem shell e argumentos fixos;
- OGG/Opus mono válido, MIME canônico e cleanup em todos os ramos;
- idempotência e reconciliação após falhas antes e depois da persistência.

### Integração e produção

- conversão real em Linux com FFmpeg/FFprobe;
- envio pelo provider demo e persistência no PostgreSQL;
- reprodução autenticada pela interface;
- SSE em duas sessões;
- desktop, tablet e celular sem overflow ou erros de console;
- build standalone, imagem Docker não privilegiada e health check;
- suíte completa, lint, tipos, Prisma, build e auditoria;
- backup e validação do bundle contendo o novo áudio final.

A entrega real à Meta será validada quando as credenciais, o número comercial e o acesso à KVM estiverem disponíveis.

## Fora de escopo

- transcrição, tradução ou resumo do áudio;
- waveform, edição, corte, filtros ou redução manual de ruído;
- pausa e retomada da gravação;
- envio automático ao parar;
- múltiplas gravações simultâneas;
- armazenamento do arquivo bruto do navegador;
- escala horizontal dos limitadores;
- mudança de esquema do banco.

## Referências

- [Meta WhatsApp Business Platform Node.js SDK — áudio](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/audio/)
- [Meta Business Messaging OpenAPI](https://github.com/facebook/openapi)
