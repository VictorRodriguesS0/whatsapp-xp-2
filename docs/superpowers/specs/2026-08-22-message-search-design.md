# Pesquisa global e interna de mensagens

Data: 2026-08-22

## Objetivo

Permitir que qualquer usuário autenticado encontre conteúdo no histórico compartilhado da empresa, tanto em todas as conversas quanto dentro de uma conversa aberta. Um resultado deve levar o atendente à mensagem exata sem alterar, por causa da pesquisa, os estados compartilhados de leitura ou resposta.

## Escopo

A pesquisa cobre:

- corpo de mensagens de texto;
- legendas de imagens, vídeos e documentos;
- nomes originais de documentos e outros anexos;
- nomes e números de contatos compartilhados;
- endereço, nome do local e coordenadas de localizações compartilhadas;
- outros campos textuais reconhecidos dos tipos de conteúdo já normalizados pela aplicação.

Não fazem parte deste incremento: transcrição de áudio, OCR de imagens, busca aproximada por erros de digitação ou um serviço externo de indexação.

## Experiência global

A área de busca existente na lista de conversas passa a distinguir dois modos:

1. **Conversas:** mantém a pesquisa atual por nome e telefone.
2. **Mensagens:** pesquisa o conteúdo indexado de todas as mensagens.

O modo Mensagens aceita termos a partir de dois caracteres, aplica um pequeno atraso durante a digitação e apresenta resultados paginados. Cada resultado exibe nome e telefone formatado do contato, trecho com a ocorrência destacada, tipo e direção da mensagem e data/hora. Estados de carregamento, ausência de resultados e falha são explícitos e permitem nova tentativa.

Ao selecionar um resultado, a aplicação abre a conversa correspondente, carrega a região do histórico que contém a mensagem, posiciona a mensagem no centro sempre que possível e aplica destaque visual temporário. O foco segue para a mensagem encontrada, preservando acessibilidade por teclado e leitor de tela.

## Experiência dentro da conversa

Uma ação de lupa no cabeçalho abre uma barra de pesquisa interna. A busca usa o mesmo índice e o mesmo critério da pesquisa global, restritos à conversa aberta.

A interface mostra a posição atual e o total encontrado. `Enter` avança, `Shift+Enter` retorna e os botões de seta oferecem as mesmas ações por mouse ou toque. `Escape` fecha a busca e devolve o foco ao botão que a abriu. Trocar de conversa encerra a pesquisa interna anterior.

Mensagens localizadas fora da página de histórico já carregada são buscadas no servidor junto com um contexto limitado de mensagens anteriores e posteriores. A tela incorpora esse trecho sem duplicar itens e preserva a atualização em tempo real.

## Persistência e índice

A tabela `messages` recebe um campo textual de pesquisa derivado exclusivamente de dados que já pertencem à mensagem. O valor é construído por uma função central, determinística e testável a partir de `body`, `content` e metadados seguros do anexo.

Uma migração:

- habilita a extensão PostgreSQL necessária para indexação por trigramas, de forma idempotente;
- adiciona e preenche o campo de pesquisa para as mensagens existentes;
- cria um índice GIN para buscas por trechos sem distinção de maiúsculas/minúsculas;
- mantém a coluna atualizada para novas mensagens e para alterações relevantes.

A normalização mantém números e coordenadas pesquisáveis, compacta espaços e aplica comparação sem distinção de caixa. A primeira versão não promete equivalência automática entre caracteres acentuados e não acentuados; isso só será incluído se puder ser garantido pela configuração real do PostgreSQL durante a implementação.

## Serviços e APIs

Um serviço de pesquisa isolado expõe dois casos de uso autenticados:

- pesquisa global, paginada por cursor estável;
- pesquisa restrita a uma conversa, com navegação determinística por data e identificador.

Os endpoints validam termo, limite, cursor e identificadores. O limite máximo é controlado pelo servidor. A resposta contém somente DTOs necessários à interface e nunca devolve o JSON bruto da mensagem.

O acesso segue a regra atual da caixa compartilhada: administradores e atendentes ativos podem pesquisar todas as conversas da empresa. Usuários inativos ou sem sessão recebem as mesmas respostas de autorização já adotadas pela aplicação.

## Consistência e tempo real

Mensagens recebidas por webhook, enviadas pelo sistema ou refletidas pelo aplicativo oficial passam pela mesma construção do texto pesquisável. A gravação da mensagem e do índice ocorre na mesma transação lógica para evitar resultados incompletos.

Novas mensagens não interrompem uma busca em andamento. Uma nova consulta ou atualização explícita incorpora resultados recentes. A abertura de um resultado não marca a conversa como lida; somente a regra existente de visibilidade do histórico pode fazer isso depois que a mensagem realmente se tornar visível ao atendente.

## Falhas e limites

- Termos menores que dois caracteres não consultam o servidor.
- Cursores inválidos retornam erro de validação seguro.
- Falha de consulta mantém o termo digitado e oferece nova tentativa.
- Resultado removido ou indisponível exibe aviso e permite voltar à lista.
- Trechos são escapados e renderizados como texto; conteúdo de clientes nunca vira HTML executável.
- Paginação e limites impedem carregar o histórico inteiro no navegador.

## Acessibilidade e responsividade

Todos os controles possuem nomes acessíveis, estados de carregamento e foco visível. A busca interna cabe no cabeçalho móvel, podendo ocupar uma linha própria. Resultados globais mantêm áreas de toque adequadas e não dependem apenas de cor para indicar direção, seleção ou ocorrência.

O destaque da mensagem respeita `prefers-reduced-motion`: sem animação para quem reduziu movimento. O trecho encontrado usa marcação semântica e contraste suficiente.

## Testes e aceitação

A implementação será aceita quando:

- a migração preencher e indexar mensagens antigas sem perda de dados;
- cada tipo suportado produzir o texto de pesquisa esperado;
- a pesquisa global respeitar autenticação, limite, ordenação e cursor;
- a pesquisa interna retornar somente mensagens da conversa solicitada;
- um resultado abrir a conversa e posicionar a mensagem exata, inclusive fora do histórico inicialmente carregado;
- teclado, fechamento por `Escape`, foco e navegação entre ocorrências funcionarem;
- HTML ou conteúdo malicioso aparecer apenas como texto;
- a busca não marcar uma conversa como lida antes da mensagem ficar visível;
- testes unitários, de integração, componentes, lint, tipos e build passarem;
- a publicação na KVM concluir com backup, migração, health checks e rollback automático disponível.
