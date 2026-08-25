# Integração do catálogo do WhatsApp da XP

**Data:** 24 de agosto de 2026
**Status:** desenho aprovado pelo usuário

## Contexto

A XP já mantém um catálogo de produtos no WhatsApp/Commerce Manager. Esse catálogo será a única fonte de produtos, preços e disponibilidade; a aplicação de atendimento não cadastrará nem editará produtos.

O estado de produção foi consultado de forma sanitizada antes deste desenho:

- o número possui configurações de comércio;
- o carrinho está habilitado;
- o catálogo está oculto no perfil do WhatsApp;
- o token atual possui `whatsapp_business_management` e `whatsapp_business_messaging`, mas não consegue listar os catálogos da empresa;
- a aplicação já reconhece mensagens recebidas do tipo `ORDER`, porém persiste somente o identificador do catálogo e a quantidade de linhas, descartando os detalhes dos itens;
- o provedor atual envia texto, templates, reações e mídia, mas ainda não envia mensagens de produto, lista de produtos ou catálogo completo.

Fontes oficiais de referência:

- coleção oficial da WhatsApp Cloud API: https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api
- mensagem de produto individual e catálogo completo: https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api?entity=request-13382743-75e65a16-c157-4877-a02a-87315efaf48e
- mensagem com vários produtos: https://www.postman.com/meta/whatsapp-business-platform/request/j1w5o6p/send-multi-product-message
- objeto oficial de pedido recebido: https://www.postman.com/meta/whatsapp-business-platform/folder/1dtuocp/messages-object
- configurações de comércio do número: https://www.postman.com/meta/whatsapp-business-platform/request/rftq09m/get-commerce-settings
- especificação OpenAPI oficial da Meta: https://github.com/facebook/openapi

## Decisões confirmadas

O usuário aprovou explicitamente:

1. usar o catálogo já cadastrado no WhatsApp da XP;
2. tornar esse catálogo visível no perfil do WhatsApp;
3. manter o carrinho habilitado;
4. manter produtos, preços e disponibilidade administrados somente na Meta;
5. consultar a Meta diretamente, com cache curto e não persistente;
6. permitir pesquisa, produto individual, seleção de produtos e catálogo completo;
7. detalhar pedidos recebidos na conversa;
8. não criar automaticamente pedidos no Tiny ou em outro sistema;
9. publicar a entrega em partes pequenas, auditando todo trabalho paralelo antes de cada deploy.

## Objetivos

- Conectar com segurança o catálogo existente da XP ao atendimento.
- Permitir que qualquer atendente autenticado pesquise produtos por nome, descrição ou código.
- Enviar mensagens oficiais de produto individual, lista de produtos e catálogo completo.
- Mostrar no histórico uma representação local, estável e acessível do conteúdo enviado.
- Preservar todas as linhas dos pedidos recebidos, incluindo quantidade, preço, moeda e total calculado com aritmética decimal segura.
- Manter credenciais e chamadas da Graph API exclusivamente no servidor.
- Respeitar janela de atendimento, templates, limites, permissões e demais políticas da Meta.
- Permitir degradação isolada: falhas do catálogo não interrompem texto, áudio, anexos, leitura ou outros recursos do inbox.

## Fora do escopo

- Criar, editar, excluir ou reordenar produtos pela aplicação.
- Duplicar permanentemente o catálogo em tabelas locais.
- Sincronizar estoque ou preço com Tiny, `catalogo-xp`, `catalogo-mobi-tiny` ou `catalogo-lojinha`.
- Criar orçamento, checkout, pagamento, reserva de estoque ou pedido interno.
- Enviar produto fora da janela de atendimento sem um template aprovado compatível.
- Criar automaticamente um template de catálogo na Meta.
- Alterar catálogos, contêineres ou bancos de outros sistemas da KVM.
- Enviar mensagens não solicitadas para clientes durante a homologação.

## Abordagens consideradas

### 1. Consulta direta à Meta com cache curto — escolhida

A aplicação consulta o catálogo oficial, guarda somente resultados normalizados em memória por aproximadamente cinco minutos e revalida os itens selecionados antes do envio. Não existe uma segunda fonte persistente de produtos.

Vantagens:

- preço e disponibilidade vêm da autoridade correta;
- nenhuma rotina de reconciliação de duas bases;
- alterações feitas no Commerce Manager convergem rapidamente;
- o cache desaparece ao reiniciar a aplicação.

### 2. Espelho local periódico — rejeitada

Uma tabela local de produtos daria pesquisa rápida e permitiria operação parcial sem a Meta, mas criaria defasagem de preço e disponibilidade, exigiria reconciliação e transformaria a aplicação em uma segunda fonte.

### 3. Códigos de produtos cadastrados manualmente — rejeitada

Seria menor tecnicamente, mas produziria uma experiência ruim, sujeita a códigos incorretos e sem pesquisa confiável.

## Ativação dos ativos da Meta

### Princípio de menor privilégio

Será reutilizado um usuário de sistema controlado pela XP. Antes de substituir qualquer token em produção, será confirmado no Meta Business Manager que esse usuário possui acesso aos três ativos corretos:

- aplicativo da XP;
- conta do WhatsApp da XP;
- catálogo já cadastrado da XP.

O token permanente deverá manter as permissões atuais de WhatsApp e receber somente os acessos adicionais exigidos pela versão da Graph API para descobrir e consultar o catálogo, normalmente `business_management` e `catalog_management`. A lista exata será validada na documentação e no depurador de token da Meta antes da geração. O token não será colado em chat, arquivo versionado, comando exibido ou log.

### Descoberta e vínculo

A ativação seguirá esta ordem:

1. listar, de forma somente leitura, os catálogos acessíveis ao Business Portfolio;
2. identificar o catálogo da XP por ID e nome, sem inferir pelo primeiro resultado;
3. confirmar que o catálogo está associado à conta/número corretos;
4. consultar o catálogo identificado e uma amostra sanitizada de produtos;
5. definir `WHATSAPP_CATALOG_ID` somente no ambiente seguro da KVM;
6. repetir a consulta pelo ID configurado;
7. habilitar `is_catalog_visible=true`, preservando `is_cart_enabled=true`;
8. reler as configurações e exigir convergência antes de ativar os botões de envio.

Se houver mais de um catálogo com nome semelhante, catálogo vazio, ativo sem associação ou permissão ambígua, a ativação para antes de qualquer mutação.

### Configuração da aplicação

`WHATSAPP_CATALOG_ID` será opcional no schema de ambiente e obrigatório apenas para ativar o recurso. Na ausência ou invalidade desse ID:

- o restante do atendimento inicia normalmente;
- o botão de produtos não é oferecido aos atendentes;
- a página administrativa explica que a integração não está pronta;
- nenhuma tentativa de envio de catálogo é feita.

O ID do catálogo não é tratado como segredo, mas permanece no servidor por simplicidade e para impedir que o cliente escolha outro catálogo.

## Arquitetura

### Cliente de catálogo

Um cliente `MetaCatalogClient`, separado do provedor de mensagens, será responsável por:

- consultar dados mínimos do catálogo configurado;
- listar produtos com paginação por cursor;
- pesquisar e recuperar produtos por `retailer_id`;
- normalizar nome, descrição, preço, moeda, disponibilidade, visibilidade e URL de imagem;
- consultar as configurações de comércio do número;
- mapear falhas para códigos públicos e sanitizados.

Separar leitura de catálogo e envio evita ampliar chamadas administrativas dentro do provedor de mensagens e facilita limites diferentes para resposta, paginação e cache.

O cliente aceitará somente URLs construídas para `graph.facebook.com` com a versão configurada. Cursors retornados pela Meta serão tratados como valores opacos, limitados e reaplicados a URLs construídas localmente; a aplicação não seguirá URLs de paginação arbitrárias contendo credenciais.

### Extensão do provedor de mensagens

A interface `WhatsAppProvider` ganhará operações tipadas para:

- `sendProduct`;
- `sendProductList`;
- `sendCatalog`.

O provedor Meta produzirá somente os formatos oficiais:

- `interactive.type = "product"` com `catalog_id` e `product_retailer_id`;
- `interactive.type = "product_list"` com uma seção e até 30 produtos;
- `interactive.type = "catalog_message"` com a ação oficial de catálogo.

O provedor de demonstração implementará respostas determinísticas sem rede. Nenhum corpo livre vindo do navegador será repassado diretamente ao payload da Meta; títulos, corpo e rodapé serão gerados ou validados pelo servidor dentro dos limites oficiais.

### Cache temporário

O cache será mantido no processo único da aplicação, sem Redis e sem novo contêiner:

- TTL padrão de cinco minutos;
- chave pelo catálogo e pela consulta/página normalizada;
- limite máximo de entradas e produtos;
- deduplicação de consultas concorrentes;
- invalidação na troca do ID do catálogo;
- estado explícito de fresco, vencido ou indisponível.

Uma busca pode apresentar o último resultado vencido quando a Meta estiver temporariamente indisponível, mas o envio nunca confia apenas nesse resultado. Os `retailer_id` selecionados são consultados novamente imediatamente antes do envio. Produto removido, invisível ou indisponível é recusado e o seletor é atualizado.

O primeiro plano de implementação deverá validar os recursos de filtro suportados pela versão Graph fixada pela aplicação. Quando houver filtro oficial confiável, ele será usado. Caso contrário, a busca trabalhará sobre páginas normalizadas em cache com limites explícitos, sem varrer indefinidamente um catálogo grande.

### Rotas internas

Rotas previstas:

- `GET /api/settings/whatsapp/catalog`: estado sanitizado, exclusivo para `ADMIN`;
- `POST /api/settings/whatsapp/catalog/refresh`: força uma leitura, com limitação de frequência, exclusivo para `ADMIN`;
- `GET /api/catalog/products`: pesquisa paginada para usuários autenticados;
- `POST /api/conversations/:id/catalog-messages`: envio de catálogo, produto ou lista para a conversa selecionada.

A rota de envio mantém a ordem de proteção já usada pelo projeto:

1. validar mesma origem;
2. autenticar o usuário ativo;
3. validar conversa, corpo, UUID de idempotência e limites;
4. verificar restrições do contato e janela de atendimento;
5. carregar o catálogo configurado no servidor;
6. revalidar todos os produtos na Meta;
7. criar ou recuperar a mensagem pendente de forma idempotente;
8. chamar o provedor;
9. persistir ID do WhatsApp e estado;
10. publicar atualização de tempo real.

### Persistência de mensagens

Não haverá tabela local de produtos. O JSON estruturado já associado a `Message` será estendido com variantes controladas:

- catálogo completo, incluindo texto e produto de destaque quando houver;
- produto individual, incluindo `retailer_id` e snapshot sanitizado;
- lista de produtos, com até 30 snapshots na ordem enviada;
- pedido detalhado, mantendo compatibilidade com pedidos antigos resumidos.

Cada snapshot de produto contém somente campos necessários à conversa:

- código de varejista;
- nome;
- descrição curta opcional;
- preço normalizado e moeda;
- disponibilidade observada;
- referência de imagem segura quando disponível.

O registro da mensagem, `sentById`, `clientRequestId`, ID do WhatsApp, horários e transições de estado formam a auditoria do envio. A ativação administrativa da visibilidade será registrada de forma sanitizada no relatório de publicação e nos logs operacionais, sem token ou payload integral.

Mensagens antigas com `{ kind: "order", catalogId, productCount }` continuam válidas. A ampliação do schema de conteúdo não inventa linhas que já foram descartadas antes desta entrega.

## Pesquisa e imagens

A pesquisa aceita nome, descrição e código, ignora diferenças simples de caixa e espaços e exige comprimento limitado. O resultado preserva a ordenação da Meta, com desempate determinístico por código.

URLs de imagem são dados não confiáveis mesmo quando vieram do catálogo. A aplicação não fará requisição autenticada para a URL de imagem e nunca encaminhará o token do WhatsApp. A visualização usará uma rota restrita que:

- resolve a imagem a partir de um produto conhecido do catálogo, não de uma URL enviada pelo cliente;
- aceita somente HTTPS;
- bloqueia destinos privados, locais e metadados de nuvem;
- revalida cada redirecionamento;
- limita tempo, bytes e MIME a imagens suportadas;
- retorna placeholder quando a origem não for segura ou estiver indisponível;
- aplica cache HTTP curto sem persistir uma biblioteca local de imagens.

Assim, miniaturas podem aparecer no seletor e no histórico sem transformar o servidor em proxy aberto.

## Interface do atendente

### Abertura do catálogo

O compositor terá um botão `Produtos` junto às ações de anexo. Ele só aparece quando a integração estiver pronta e a política permitir composição para a conversa.

- Desktop: painel lateral relacionado à conversa.
- Celular: folha/tela deslizante ocupando a área útil.
- `Escape`, gesto de voltar e botão de fechar encerram primeiro a camada do catálogo.
- Abrir ou fechar o painel não apaga texto, resposta rápida, anexo ou resposta citada em preparação.

### Estados e ações

O painel contém:

- busca;
- ação `Enviar catálogo completo`;
- cartões de produto com imagem, nome, código, preço e disponibilidade;
- envio imediato de um produto;
- seleção múltipla;
- contador e limite de 30 itens;
- revisão antes de enviar uma lista;
- carregamento, vazio, vencido, indisponível e nova tentativa.

Uma mensagem individual não exige revisão adicional além do clique explícito em enviar. Uma lista exige uma etapa de revisão para evitar seleção acidental. Um produto indisponível não pode ser selecionado.

Todos os controles têm nome acessível, foco visível, navegação por teclado e área de toque adequada. Cor nunca é o único indicador de disponibilidade ou erro.

### Histórico da conversa

Mensagens enviadas aparecem imediatamente de forma otimista, usando o mesmo ciclo `PENDING`, `SENT`, `DELIVERED`, `READ` ou `FAILED` das mensagens existentes. O cartão local mostra o snapshot aprovado; o WhatsApp do cliente renderiza o cartão oficial da Meta.

Um envio falho oferece nova tentativa somente enquanto a janela e os produtos continuarem válidos. Antes da repetição, os itens são revalidados e o mesmo mecanismo de idempotência impede duplicação.

## Pedidos recebidos

### Normalização

O normalizador de webhook preservará, com limites estritos:

- `catalog_id`;
- texto opcional do cliente;
- no máximo o limite documentado de linhas aceito pela aplicação;
- `product_retailer_id`;
- quantidade inteira positiva;
- preço unitário decimal normalizado;
- código de moeda ISO de três letras.

Dinheiro não será convertido para ponto flutuante. Subtotais e totais usam aritmética decimal exata. Valores de moedas diferentes são agrupados e nunca somados como se fossem equivalentes.

O webhook assinado é persistido de forma idempotente antes de qualquer enriquecimento. A disponibilidade da API de catálogo não pode decidir se o pedido é recebido.

### Enriquecimento

Como o webhook oficial fornece códigos, quantidades e preços, mas não garante nome e imagem, a aplicação tenta enriquecer os itens após a persistência usando o catálogo configurado e um limitador interno. Não haverá novo contêiner nem fila externa.

- sucesso: nome, descrição curta, disponibilidade e referência segura de imagem são anexados ao snapshot;
- falha: o cartão aparece com o código do produto, quantidade e valores já recebidos;
- nova leitura ou atualização administrativa pode tentar novamente sem duplicar o pedido;
- o preço do webhook continua sendo o preço histórico do pedido, mesmo que o catálogo mude depois.

### Cartão de pedido

O cartão mostra:

- título `Pedido recebido`;
- texto do cliente quando presente;
- produto ou código de cada linha;
- quantidade;
- preço unitário;
- subtotal por linha;
- total por moeda;
- ação `Responder ao cliente`.

`Responder ao cliente` apenas fecha outras camadas, posiciona o foco no compositor e preserva a escolha do atendente. Não confirma pedido, não reserva estoque e não envia mensagem automaticamente.

## Regras da Meta e política de envio

- Produto, lista e catálogo completo são mensagens interativas livres e só podem ser enviados quando a política atual autorizar a conversa.
- Fora da janela, o botão é bloqueado e a interface direciona para um template aprovado; esta entrega não cria esse template.
- A seleção múltipla usa no máximo 30 produtos e uma única seção no primeiro recorte.
- O servidor não aceita `catalog_id` vindo do navegador.
- O servidor não aceita produto de outro catálogo.
- O catálogo completo usa a associação oficial do número, confirmada durante ativação.
- Nenhum envio de homologação será feito para cliente real sem consentimento e contexto autorizado.
- Eventos e ecos de dispositivos continuam passando pelas regras existentes. Tipos de eco de catálogo que a Meta não fornecer de forma estruturada degradam para uma descrição segura sem quebrar a sincronização.

## Administração

Somente `ADMIN` acessa `Configurações → WhatsApp → Catálogo`. A página é de observação e diagnóstico, não de edição de produtos. Ela mostra:

- nome e ID mascarado/parcialmente apresentado do catálogo;
- quantidade conhecida de produtos;
- catálogo visível ou oculto;
- carrinho habilitado ou desabilitado;
- instante da última consulta bem-sucedida;
- estado fresco, vencido ou indisponível;
- código público da última falha;
- permissões ausentes de forma orientativa;
- ação de atualizar leitura, limitada por frequência.

Nenhum token, escopo bruto desnecessário, payload, URL assinada ou erro integral da Graph API aparece na página.

## Segurança e privacidade

- Todas as rotas exigem sessão ativa; as de configuração exigem `ADMIN` no servidor.
- A assinatura Meta é validada antes do processamento de pedidos.
- Token e segredo do app permanecem somente no ambiente de produção.
- Erros da Graph são sanitizados antes de log, resposta ou persistência.
- Respostas JSON têm limite de bytes, páginas e itens.
- Consultas têm timeout e cancelamento.
- Cursors são limitados e não podem redirecionar credenciais.
- O proxy de imagens possui defesa contra SSRF, redirects, arquivos grandes e MIME incorreto.
- Conteúdo estruturado nunca preserva o payload bruto completo.
- Ações de envio mantêm usuário, idempotência, timestamps e estado auditáveis.
- O cache de catálogo é exclusivamente de servidor e desaparece no restart.
- Dados de pedidos são conteúdo da conversa e seguem as mesmas regras de acesso, retenção e exclusão já aplicadas às mensagens.

## Falhas e recuperação

- Catálogo não configurado: recurso oculto para atendentes e diagnóstico para administradores.
- Permissão ausente: status administrativo explícito; demais mensagens continuam funcionando.
- Meta indisponível durante busca: último cache pode ser exibido como vencido; envio exige revalidação e permanece bloqueado.
- Produto removido entre seleção e envio: item retirado da seleção com explicação; nenhum payload parcial é enviado sem nova confirmação.
- Falha depois de criar a mensagem pendente: mantém estado recuperável e a tentativa idempotente existente.
- Webhook de pedido duplicado: uma única mensagem e um único conjunto de linhas.
- Pedido malformado: não cria valores inventados; segue a estratégia existente de rejeição/quarentena sem comprometer outros eventos válidos do lote.
- Falha de enriquecimento: cartão útil com códigos e valores, seguido de tentativa limitada posterior.
- Imagem insegura ou indisponível: placeholder, sem quebrar produto ou pedido.
- Cache corrompido ou excedido: descarte integral da entrada e nova consulta limitada.
- Recurso desligado: texto, mídia, gravação, reações, busca e sincronização continuam operacionais.

## Testes

### Cliente Meta e provedor

- paginação, cursores repetidos, limites e cancelamento;
- catálogo inexistente, token sem permissão, rate limit, timeout e JSON grande;
- normalização de produto, dinheiro, disponibilidade e imagem;
- cache fresco, vencido, concorrente, invalidado e limitado;
- revalidação obrigatória antes do envio;
- payload exato de produto, lista e catálogo completo;
- máximo de 30 produtos, duplicados, outro catálogo e indisponíveis;
- erros sanitizados sem token, URL assinada ou corpo bruto.

### Domínio e persistência

- idempotência concorrente por `clientRequestId`;
- criação pendente, envio, falha, retry e estados posteriores;
- snapshot preservado após mudança do catálogo;
- compatibilidade com pedidos antigos resumidos;
- normalização completa de pedido, limites e campos inválidos;
- aritmética decimal, quantidade, subtotal e agrupamento por moeda;
- webhook duplicado e lotes parcialmente inválidos;
- enriquecimento posterior idempotente e falho.

### API e autorização

- mesma origem antes de mutações;
- usuário inativo ou não autenticado;
- configuração exclusiva para `ADMIN`;
- pesquisa disponível a atendentes autenticados;
- conversa inexistente ou fora do escopo;
- contato restrito e janela fechada;
- catálogo ID vindo do cliente rejeitado;
- limitadores de busca, refresh, envio e imagem.

### Interface

- desktop e celular;
- abertura, fechamento, `Escape`, gesto de voltar e restauração de foco;
- preservação de texto, resposta rápida, anexo e resposta citada;
- pesquisa, paginação e estados de falha;
- produto individual e seleção/revisão múltipla;
- limite de 30 e remoção de item indisponível;
- mensagem otimista e estados de entrega;
- cartão de pedido completo e fallback sem enriquecimento;
- teclado, leitor de tela, foco e contraste;
- ausência de regressão no compositor e nas outras camadas móveis.

### Regressão e segurança

- suíte completa, lint, typecheck, Prisma e build de produção;
- auditoria de dependências de produção sem vulnerabilidade conhecida bloqueante;
- verificação de ausência de token em bundle, imagem e logs;
- testes SSRF do proxy de imagem com loopback, redes privadas, IPv6, DNS rebinding simulado e redirects;
- imagem Linux executada como usuário não root;
- contratos de Compose, migração e rollback.

## Publicação incremental

### Release A — conexão e consulta

- schema de ambiente opcional;
- cliente de catálogo, cache e rotas de leitura;
- página administrativa;
- seletor pesquisável ainda sem envio quando a ativação não estiver pronta;
- deploy app-only e diagnóstico real sanitizado.

### Release B — envio de produtos

- operações do provedor;
- rota idempotente de envio;
- seletor completo, produto individual, lista e catálogo completo;
- histórico estruturado e estados de entrega;
- deploy app-only e um envio manual controlado para número autorizado.

### Release C — pedidos detalhados

- conteúdo estruturado ampliado;
- normalização e persistência das linhas;
- enriquecimento limitado;
- cartão de pedido e totais;
- deploy app-only e pedido controlado feito pelo próprio fluxo de catálogo.

Cada release só é considerada concluída depois de estar saudável em produção e passar por aceitação proporcional ao risco. Uma release incompleta não habilita botões que dependam da próxima.

## Protocolo obrigatório antes de cada deploy

Como vários Codex trabalham em paralelo no mesmo repositório, imediatamente antes de cada publicação será obrigatório:

1. ler o commit e a imagem realmente ativos na KVM;
2. confirmar saúde, reinícios e identidade dos contêineres atuais;
3. auditar todas as worktrees, branches, commits e árvores sujas;
4. não copiar, sobrescrever ou integrar alterações não commitadas de outra frente;
5. identificar trabalhos concluídos depois da base desta implementação;
6. montar uma versão revisada que seja descendente/superset da produção e dos trabalhos concluídos relevantes;
7. repetir testes focados e completos depois de qualquer integração;
8. comparar configuração, migrations e conteúdo da imagem candidata;
9. fazer e validar backup de banco, mídia e configuração antes de migração ou troca;
10. construir uma imagem imutável rotulada com o commit exato;
11. homologar a imagem em ambiente isolado;
12. recriar somente `xp-whatsapp-app`, sem reiniciar banco, proxy, catálogos ou outros sistemas;
13. verificar saúde, login, conversa, mensagens, mídia, catálogo e logs;
14. comparar a lista/identidade dos contêineres não relacionados antes e depois;
15. observar a aplicação por um período curto e confirmar zero reinício inesperado.

Se produção avançar ou uma frente paralela relevante permanecer incompleta, o deploy para. O desenvolvimento local pode continuar sem incorporar trabalho inseguro.

## Rollback

- Cada release conserva a imagem anterior e o caminho do release anterior.
- Mudanças de banco, quando necessárias, serão aditivas e compatíveis com a imagem de rollback comprovada.
- Remover `WHATSAPP_CATALOG_ID` ou desabilitar a exposição do recurso oculta o catálogo na aplicação sem afetar mensagens existentes.
- A visibilidade do catálogo na Meta é uma mudança separada e reversível; reverter a aplicação não deve alterar automaticamente essa configuração externa.
- Um rollback de código recria somente `xp-whatsapp-app`.
- Nenhum rollback remove pedidos, mensagens, volumes ou ativos da Meta.

## Critérios de aceitação

- O catálogo correto da XP é identificado e validado antes de qualquer ativação.
- A Meta confirma catálogo visível e carrinho habilitado.
- A página administrativa mostra estado útil sem segredos.
- Atendentes pesquisam por nome, descrição e código em desktop e celular.
- Um produto, uma lista e o catálogo completo chegam ao WhatsApp como mensagens oficiais.
- Nenhum envio livre de catálogo ocorre fora da janela autorizada.
- Cliques repetidos não duplicam mensagens.
- Produtos removidos, invisíveis ou indisponíveis não são enviados.
- Histórico local preserva snapshots e estados de entrega.
- Pedidos novos exibem linhas, quantidades, preços, moedas, subtotais e total exato.
- Pedidos antigos resumidos continuam renderizando sem erro.
- Falha do catálogo não interrompe as demais funcionalidades.
- A imagem publicada preserva todos os trabalhos paralelos concluídos e contém integralmente a revisão anterior de produção.
- Somente o contêiner da aplicação é recriado durante cada rollout.
