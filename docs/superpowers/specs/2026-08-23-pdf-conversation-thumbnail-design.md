# Miniatura de PDF na conversa — desenho aprovado

## Objetivo

Mostrar no balão de cada PDF uma miniatura real da primeira página, com aparência e interação próximas ao WhatsApp móvel, tanto para documentos recebidos quanto enviados. O clique continua abrindo o visualizador completo já existente.

## Experiência no balão

- PDFs disponíveis exibem um cartão clicável com largura máxima de aproximadamente 16rem, limitado pela largura do balão e da tela.
- A parte superior mostra um recorte da primeira página, ajustado à largura e ancorado no topo para preservar cabeçalhos, títulos e elementos reconhecíveis.
- A parte inferior mostra ícone de PDF, nome do arquivo truncado e a indicação `PDF`, sem badges ou ações redundantes.
- Todo o cartão é um único botão acessível com alvo de toque mínimo de 44px. Ao clicar, o foco permanece rastreável e o visualizador completo abre no PDF correspondente.
- Enquanto a imagem carrega, a área da miniatura usa uma superfície neutra discreta, sem spinner permanente.
- Se a geração ou o carregamento da miniatura falhar, o cartão regride para a apresentação atual com ícone e nome. A abertura do PDF completo continua disponível.
- PDFs pendentes, indisponíveis ou em recuperação mantêm os estados já existentes; não se mostra uma miniatura enganosa antes de a mídia estar disponível.
- Documentos que não sejam PDF não mudam.

## Abordagem escolhida

A primeira página será renderizada no servidor e guardada em cache privado como PNG. Essa abordagem evita baixar e interpretar o PDF inteiro em cada navegador, produz o mesmo resultado em desktop e celular e não depende do visualizador PDF nativo para montar a miniatura.

Foram rejeitadas duas alternativas:

- PDF.js no cliente: aumenta JavaScript, memória e processamento em cada atendimento aberto, além de baixar PDFs completos para produzir miniaturas.
- Mini-iframe nativo: carrega o documento completo, expõe variações entre navegadores e pode incluir controles do visualizador dentro do balão.

## Componentes e responsabilidades

### `PdfMessagePreview`

Componente visual isolado usado por `MessageMedia` somente quando o documento tem MIME validado `application/pdf` e mídia disponível. Recebe nome, URL autenticada da miniatura e callback de abertura. Controla apenas os estados local de carregamento, carregado e fallback; não conhece armazenamento nem executa recuperação de mídia.

### Serviço de miniatura

Um módulo exclusivo de servidor:

- autentica e autoriza o acesso ao mesmo objeto de mídia já visível para o usuário;
- exige status disponível e MIME validado `application/pdf`;
- usa o identificador e o SHA-256 da mídia como identidade do cache;
- reutiliza uma miniatura válida ou coordena uma única geração em andamento para a mesma mídia;
- copia o fluxo autenticado do PDF para uma área temporária privada e limitada;
- executa `pdftoppm` sem shell para renderizar somente a página 1 em largura máxima de 640px;
- valida assinatura, dimensões e limite de bytes do PNG antes da publicação;
- publica o arquivo por renomeação atômica em uma árvore privada de derivados sob `MEDIA_ROOT`;
- limpa entradas temporárias em sucesso, falha, aborto ou timeout.

A geração terá concorrência baixa e separada do download de mídias. Cada processo terá mapa de tarefas em andamento para evitar trabalho duplicado; a escrita atômica resolve corridas entre processos sem exigir mudança no banco.

### Rota autenticada

`GET /api/media/:id/thumbnail` retorna somente `image/png`. A rota exige sessão ativa e a mesma autorização da mídia original. Respostas usam `X-Content-Type-Options: nosniff`, `Content-Disposition: inline` e cache privado sem armazenamento no navegador. O cache persistente é interno ao servidor.

## Fluxo de dados

1. A conversa recebe um PDF disponível e monta a URL autenticada da miniatura pelo `mediaObjectId`.
2. O navegador solicita a rota de thumbnail apenas quando renderiza o balão.
3. A rota valida usuário, vínculo da mídia, status e MIME.
4. Se o PNG cacheado for válido, ele é transmitido imediatamente.
5. Caso contrário, o serviço limita a tarefa, prepara o PDF, renderiza a página 1, valida e publica o PNG de forma atômica.
6. O componente troca a superfície de carregamento pela miniatura. Qualquer falha visual aciona o cartão simplificado, sem afetar o visualizador completo.

## Segurança e limites operacionais

- Nenhum caminho local, chave de armazenamento, hash, comando ou mensagem interna de erro é enviado ao cliente.
- Identificadores públicos continuam validados como UUID e autorização ocorre antes de consultar ou produzir derivados.
- `pdftoppm` é chamado com argumentos fixos e `shell: false`; nomes fornecidos pelo usuário nunca entram como argumentos de caminho.
- Apenas a primeira página é renderizada, com largura limitada a 640px, timeout de 10 segundos, concorrência global de uma geração ativa e saída máxima de 4 MiB.
- Arquivos e diretórios de staging e cache rejeitam links simbólicos, ficam contidos em `MEDIA_ROOT` e usam permissões privadas.
- O processo roda como o usuário não privilegiado já configurado no container. O pacote `poppler-utils` será instalado na imagem versionada.
- PDFs inválidos, protegidos por senha, excessivamente complexos ou que excedam os limites resultam apenas no fallback visual. O PDF original não é alterado.
- O gateway não recebe nova exceção de iframe ou rota pública.

## Cache, retenção e backup

- A chave do derivado inclui o SHA-256 do PDF; a troca do conteúdo invalida naturalmente a miniatura anterior.
- O cache vive em diretório próprio sob `MEDIA_ROOT` e acompanha o volume persistente da aplicação.
- Não há migração de banco. A miniatura pode ser regenerada a qualquer momento, então sua ausência em uma restauração não compromete mensagens nem PDFs.
- A implementação ajustará a política de backup explicitamente: derivados regeneráveis não entram no arquivo de backup, evitando crescimento desnecessário. A restauração recria apenas o diretório privado quando necessário.

## Tratamento de erros

- `401` mantém a semântica atual de sessão expirada.
- Mídia inexistente, não vinculada ou não visível retorna `404` sem distinguir a causa.
- Mídia ainda não disponível ou MIME não elegível retorna uma resposta segura que leva o componente ao fallback, sem detalhes internos.
- Timeout, falha do Poppler, PNG inválido e erro de armazenamento são registrados de forma sanitizada no servidor e retornam erro genérico.
- O erro de miniatura nunca altera o estado da mídia original nem dispara nova tentativa de download do WhatsApp.

## Testes e verificação

- Testes do serviço cobrem cache hit, geração única concorrente, argumentos fixos sem shell, timeout, limpeza, saída inválida, limite de bytes, contenção de paths e publicação atômica.
- Testes da rota cobrem autenticação, autorização, UUID inválido, MIME não PDF, mídia indisponível, cabeçalhos e PNG válido.
- Testes de `MessageMedia` cobrem recebidos e enviados, estado de carregamento, miniatura carregada, fallback e clique que abre o visualizador com foco preservado.
- A suíte existente deve continuar cobrindo o download de outros documentos e o visualizador PDF completo.
- Verificação no navegador será feita em desktop e viewport móvel com um PDF recebido e um enviado, incluindo carregamento inicial, cache hit, fallback forçado e abertura em tela cheia.
- Antes do deploy, worktrees e branches paralelas serão auditadas novamente para integrar apenas trabalhos concluídos e evitar sobreposição.
- O deploy usará uma imagem imutável com `poppler-utils`; somente o container da aplicação será recriado. Banco, gateway e demais sistemas da KVM permanecerão intactos.

## Fora do escopo

- Miniaturas de arquivos Word, Excel, PowerPoint ou texto.
- Pré-renderização de todas as páginas ou navegação de páginas dentro do balão.
- OCR, busca ou extração de texto do PDF.
- Alterações no visualizador PDF completo.
- Persistência da miniatura no banco ou envio da miniatura ao WhatsApp.
