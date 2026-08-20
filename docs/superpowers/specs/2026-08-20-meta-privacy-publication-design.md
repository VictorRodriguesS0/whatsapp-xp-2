# Páginas públicas para publicação do XP Atendimento na Meta

Data: 20 de agosto de 2026

## Objetivo

Disponibilizar, no domínio `https://whatsapp.xpeletronicos.com`, as informações públicas exigidas para publicar o aplicativo **XP Atendimento** na Meta e operar o número **+55 61 9514-9019** pela WhatsApp Cloud API.

## Escopo

Serão criadas duas rotas públicas:

- `/privacidade`: Política de Privacidade do XP Atendimento.
- `/exclusao-de-dados`: instruções para solicitar acesso, correção ou exclusão de dados pessoais.

As duas páginas serão acessíveis sem autenticação e terão links recíprocos. A tela de login também exibirá links discretos para esses documentos.

## Conteúdo

### Política de Privacidade

A página identificará a XP Eletrônicos como responsável pelo atendimento e explicará, em linguagem direta:

- quais dados podem ser tratados: nome e identificador do WhatsApp, telefone, conteúdo das mensagens, anexos, datas, estados de entrega e registros operacionais;
- finalidades: responder solicitações, organizar o atendimento, atribuir responsáveis, enviar e receber mensagens e manter segurança e continuidade do serviço;
- compartilhamentos necessários: Meta/WhatsApp, infraestrutura contratada e autoridades quando houver obrigação legal;
- retenção: somente pelo período necessário às finalidades operacionais e às obrigações legais aplicáveis;
- medidas de segurança e limitação de acesso;
- direitos de acesso, correção e exclusão;
- canal de contato oficial: WhatsApp `+55 61 9514-9019`;
- data da última atualização.

O texto não prometerá eliminação de registros cuja conservação seja legalmente obrigatória e não apresentará a página como aconselhamento jurídico.

### Exclusão de dados

A página orientará o titular a enviar a frase **“Solicitação de exclusão de dados”** para o WhatsApp oficial. A XP Eletrônicos poderá confirmar a identidade antes de atender ao pedido. O texto explicará que:

- o solicitante receberá confirmação do recebimento;
- dados vinculados ao atendimento serão localizados e avaliados;
- dados elegíveis serão excluídos ou anonimizados;
- registros sujeitos a obrigação legal poderão ser preservados pelo prazo aplicável;
- o resultado será comunicado pelo mesmo canal.

Nenhum formulário público adicional será criado neste escopo.

## Interface

Tese visual: documento institucional calmo, legível e coerente com a superfície operacional do XP Atendimento.

As páginas reutilizarão os tokens existentes, fundo claro, verde institucional, tipografia atual e layout sem cartões decorativos. O cabeçalho mostrará **XP Eletrônicos** e o contexto do documento. O conteúdo terá largura de leitura confortável, títulos hierárquicos, listas curtas e alvos de toque de pelo menos 44 px. Não haverá animações, imagens ou elementos promocionais, pois não ajudam a compreensão de um documento operacional.

## Arquitetura

As rotas serão páginas estáticas do Next.js App Router, renderizadas no servidor e independentes de banco de dados, sessão ou APIs externas. Metadados próprios fornecerão título e descrição. Um pequeno componente compartilhado poderá concentrar cabeçalho, navegação entre documentos e rodapé quando isso reduzir duplicação sem acoplar o conteúdo.

O middleware e as proteções de autenticação devem permitir explicitamente as duas rotas. Nenhum segredo, identificador interno da Meta ou dado de cliente será incluído no HTML.

## Tratamento de falhas

Como as páginas não dependem de serviços externos, a principal falha possível é erro de build ou bloqueio indevido pelo redirecionamento de autenticação. Os testes devem detectar ambos. A publicação na Meta só continuará depois de as URLs públicas retornarem HTTP 200 pela internet.

## Testes e verificação

O ciclo será test-first:

1. testes falham demonstrando que as duas rotas ainda não existem ou não têm o conteúdo obrigatório;
2. implementação mínima das páginas e links;
3. testes focados passam;
4. lint, tipos, suíte completa e build passam;
5. verificação visual em desktop e celular confirma legibilidade, foco e ausência de overflow;
6. implantação somente do aplicativo na KVM;
7. `https://whatsapp.xpeletronicos.com/privacidade` e `/exclusao-de-dados` retornam HTTP 200.

## Publicação na Meta

Depois da implantação:

1. cadastrar `/privacidade` como URL da Política de Privacidade;
2. cadastrar `/exclusao-de-dados` como URL/instrução de exclusão de dados, quando o painel solicitar;
3. revalidar os requisitos de publicação;
4. apresentar ao usuário o efeito da mudança para modo publicado;
5. somente após confirmação explícita, acionar a publicação final;
6. testar recebimento real enviando uma mensagem de outro telefone ao número da loja.

## Fora de escopo

- assessoria jurídica ou garantia de conformidade legal integral;
- formulário automatizado de direitos do titular;
- exclusão automática no banco de dados;
- alterações em cobrança, modelos de mensagem ou verificação empresarial da Meta;
- gravação de áudio, que permanece em uma evolução separada.

## Critérios de aceite

- ambas as páginas são públicas e retornam HTTP 200;
- o texto identifica finalidades, categorias de dados, compartilhamento, retenção, segurança, direitos e canal de contato;
- a página de exclusão descreve um processo executável pelo WhatsApp oficial;
- a tela de login contém links para os documentos;
- nenhuma página exige sessão ou expõe segredo;
- desktop e celular permanecem legíveis e sem overflow;
- os gates automatizados e o build de produção passam;
- as URLs são aceitas pelo painel da Meta antes da solicitação de publicação.
