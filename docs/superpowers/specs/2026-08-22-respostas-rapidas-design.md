# Respostas rápidas compartilhadas

## Objetivo

Permitir que qualquer usuário da central cadastre respostas frequentes e que os atendentes encontrem essas respostas digitando `/` no compositor. A seleção deve apenas preencher o campo para revisão; o envio continua sendo uma ação explícita do atendente.

## Escopo

Cada resposta rápida possui:

- atalho único, armazenado sem a barra inicial;
- mensagem de texto fixa, com suporte a múltiplas linhas;
- estado ativo ou inativo;
- posição estável para ordenação;
- datas de criação e atualização.

Atalhos aceitam letras minúsculas sem acento, números, hífen e sublinhado. A entrada é normalizada para minúsculas e não aceita espaços. Nesta versão não haverá variáveis, anexos, categorias nem importação das respostas do aplicativo WhatsApp Business.

## Permissões

Administradores e atendentes autenticados podem listar, criar, editar e ativar ou desativar respostas rápidas. O catálogo é único e compartilhado pela empresa. Registros desativados permanecem no banco, mas não são oferecidos no compositor.

## Gerenciamento

Uma nova tela de configurações exibirá todas as respostas, inclusive as desativadas. Ela permitirá:

- criar uma resposta;
- editar atalho e mensagem;
- desativar e reativar;
- identificar claramente conflitos e campos inválidos.

A central de atendimento terá um acesso direto à tela. A API autenticada usará endpoints específicos para coleção e item. Atalhos duplicados, inclusive após normalização, retornarão conflito. Mensagem vazia e atalho inválido retornarão erro de validação.

## Uso no compositor

Quando o texto começar com `/`, o compositor abre uma lista acima do campo. O texto após a barra filtra por atalho e mensagem, sem diferenciar maiúsculas e minúsculas. Somente respostas ativas aparecem.

O usuário poderá:

- navegar com `ArrowUp` e `ArrowDown`;
- selecionar com `Enter`, clique ou toque;
- fechar a lista com `Escape`;
- continuar digitando quando nenhum resultado corresponder.

Ao selecionar, a mensagem substitui a consulta `/...`, permanece no campo e recebe foco. Ela nunca é enviada automaticamente. O atendente pode revisar, complementar ou apagar antes de enviar. Mudar de conversa limpa tanto o texto quanto o estado da lista, preservando o comportamento atual.

Se o catálogo não puder ser carregado, a composição e o envio de mensagens continuam funcionando. A interface mostra um aviso discreto e permite tentar novamente, sem bloquear o atendimento.

## Arquitetura e dados

Uma tabela `quick_replies` armazenará o catálogo compartilhado. O módulo de domínio cuidará de normalização, validação e conflitos; as rotas HTTP cuidarão de autenticação e tradução de erros. Uma tela cliente consumirá a API de administração. O inbox carregará as respostas ativas e as fornecerá ao compositor, que manterá localmente a consulta e a opção selecionada.

Eventos de atualização do catálogo não precisam aparecer instantaneamente em outras sessões nesta primeira versão. A lista será atualizada ao recarregar a central ou abrir uma nova sessão. Isso evita ampliar o protocolo de tempo real sem necessidade para o MVP.

## Tratamento de erros

- `400`: atalho ou mensagem inválidos;
- `401`: sessão ausente ou expirada;
- `409`: atalho já utilizado;
- `404`: resposta removida ou inexistente;
- `500`: falha inesperada, apresentada sem expor detalhes internos.

Desativação será preferida a exclusão física para preservar estabilidade e permitir reativação.

## Testes e aceite

A implementação seguirá TDD e deverá comprovar:

- migração e restrição de unicidade no banco;
- normalização e validação de atalhos;
- acesso de administrador e atendente;
- criação, edição, desativação, reativação e conflitos na API e na tela;
- abertura ao digitar `/`, filtro por atalho ou mensagem e ausência de itens inativos;
- navegação por teclado e interação por toque/clique;
- seleção que preenche sem enviar;
- `Escape` que fecha apenas o menu quando ele estiver aberto;
- funcionamento normal do compositor quando o catálogo falhar;
- regressão dos fluxos atuais de texto, anexo e áudio.

Antes do deploy serão executados testes automatizados, lint, verificação de tipos, build de produção e uma verificação manual do fluxo principal. O deploy seguirá o processo existente da KVM e será validado por health check e pela aplicação publicada.
