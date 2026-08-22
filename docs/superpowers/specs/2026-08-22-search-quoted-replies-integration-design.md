# Integração de pesquisa e respostas citadas

Data: 2026-08-22

## Contexto

A pesquisa de mensagens foi publicada na revisão `ed4aaecc02fb837f6d662988b6b8f3664de24334`. Depois, a revisão paralela `119848c02f94f62c92eef126d5311db503ca71bb`, que implementa respostas citadas, substituiu o container de produção. As duas linhas partem de `b539aeab04441f9d1334fc74d2034f5bc1877fa3`; por isso, a revisão posterior contém a migration da pesquisa, mas não contém suas APIs, hooks ou interface.

## Objetivo

Publicar uma única revisão que preserve integralmente as respostas citadas já disponíveis e recupere a pesquisa global e interna de mensagens, sem alterar dados, estados de leitura ou regras da Meta.

## Abordagem escolhida

Usar a linha da pesquisa como branch de integração e fazer merge da revisão de respostas citadas. Resolver conflitos pelo comportamento combinado, sem descartar arquivos de nenhuma funcionalidade. A migration `202608220003_message_search` continuará única e será seguida pela migration `202608220004_quoted_replies` já existente na linha mais nova.

Uma simples republicação de `ed4aae…` foi descartada porque removeria as respostas citadas. Também foi descartado copiar arquivos manualmente entre releases, pois isso perderia a proveniência Git e aumentaria o risco de omissões.

## Comportamento preservado

- Pesquisa global com o seletor **Mensagens**.
- Pesquisa na conversa aberta, navegação entre resultados e destaque da mensagem exata.
- Busca sem marcar mensagens como lidas ou respondidas.
- Criação, envio, ingestão e reconciliação de respostas citadas.
- Compatibilidade com mensagens antigas e com a migration já aplicada em produção.

## Verificação

- Um teste de integração de release deve comprovar que a árvore integrada contém simultaneamente as rotas/componentes da pesquisa e os fluxos de respostas citadas.
- Executar a suíte completa, lint, TypeScript, validação Prisma, auditoria e build de produção.
- Construir imagem imutável com a revisão Git integrada no label OCI.
- Criar e validar backup de banco e mídias antes do deploy.
- Aplicar migrations de forma idempotente e recriar somente o container da aplicação.
- Confirmar no container publicado a presença dos dois conjuntos de artefatos, além de saúde, logs, reinícios, rotas públicas e estabilidade em três amostras.

## Rollback

Se a nova aplicação não ficar saudável, restaurar o symlink e a imagem `119848c02f94f62c92eef126d5311db503ca71bb`. As migrations são aditivas e já estão aplicadas, portanto o rollback da aplicação permanece compatível com o schema atual.

