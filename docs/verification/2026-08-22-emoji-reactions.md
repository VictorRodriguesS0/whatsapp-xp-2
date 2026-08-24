# Reações com emoji — verificação de produção

Data: 2026-08-22/23

## Release

- Revisão publicada: `15b323036108bbb4d1240e3bd53db26f90114ddc`.
- Imagem imutável: `xp-whatsapp:15b323036108bbb4d1240e3bd53db26f90114ddc`.
- ID da imagem: `sha256:2b60cfe297a64abf0268f6a78827beb5c11e5562ef2c0bf60b2f54bafa80e2ab`.
- ID do container publicado: `22ed8a4c4dfa581df28f70a0d605c96d7dd68d050377fcde4332a123e79c9068`.
- Início estável: `2026-08-23T00:10:03.480291533Z`.
- Release anterior preservada para rollback: `119848c02f94f62c92eef126d5311db503ca71bb`.

## Integração paralela

Antes da publicação, a linha de reações foi mesclada com a release consolidada de pesquisa de mensagens e respostas citadas. Os conflitos compartilhados em balão, conversa, caixa de entrada, provedor e normalização de webhook foram resolvidos preservando os três recursos. A migração de reações foi ordenada depois de `202608220003_message_search` e `202608220004_quoted_replies`.

## Gates locais e isolados

- Suíte completa: 131 arquivos aprovados, 2 ignorados; 1.211 testes aprovados, 3 ignorados e zero falhas.
- Testes focados de busca, respostas e reações: 112 aprovados.
- ESLint, TypeScript, Prisma validate/generate e build Next.js: aprovados.
- Auditoria das dependências de produção: zero vulnerabilidades.
- PostgreSQL descartável criado do zero: 14 migrações aplicadas na ordem esperada.
- Gate Linux isolado da imagem: aplicação saudável, HTTP 200, 14 migrações concluídas e tabela `message_reactions` presente.
- Imagem validada como UID/GID efetivo `1001:1001`, com FFmpeg, FFprobe, migrations e cliente Prisma; sem árvore fonte da aplicação nem configuração Vitest.

## Incidente de infraestrutura anterior ao deploy

O primeiro build na KVM de 4 GB executou duas instalações de dependências em paralelo, esgotou memória e swap e tornou a VM temporariamente indisponível. O build foi interrompido antes de qualquer deploy ou migração. Com autorização explícita do usuário, a KVM foi reiniciada pela API da Hostinger.

Após o boot, a release anterior do WhatsApp e o mesmo banco retornaram saudáveis. O sistema `catalogo-mobi-tiny` revelou um marcador temporário `.health-readiness-probe` incompatível com sua própria validação de startup. O arquivo foi movido, sem exclusão, para `/root/catalogo-recovery/health-readiness-probe-20260823T000050Z`; catálogo e scheduler voltaram a executar e o catálogo ficou saudável. A KVM passou a reportar 8 GB utilizáveis. O novo build reutilizou cache e foi limitado a meia CPU, 2 GB de RAM e 3 GB incluindo swap; a produção permaneceu saudável durante todo esse build.

## Backup e implantação

- Backup validado: `/srv/backups/example-app/example-backup`.
- Snapshot pré/pós-deploy dos containers não relacionados: `31d102221d1d10fff585b68f62f009182e1124b55a2a85795228c5b7d7ca3e22`, idêntico.
- Somente `xp-whatsapp-app` foi encerrado e recriado durante o deploy.
- O container PostgreSQL manteve o ID `4804d7dee6031cd657b94ebca9a4bd6c945e364e02b4d974f848d399124ee585` durante o deploy.
- Migration aplicada: `202608220005_message_reactions`.
- Estado final: 14 migrações concluídas, nenhuma pendente e tabela `message_reactions` presente.
- O rollback automático para `119848c` permaneceu armado e não foi acionado.

## Pós-deploy

- Três amostras espaçadas: saúde local 200, saúde pública 200, container saudável e zero reinícios.
- `/login`: HTTP 200.
- `/conversas` sem sessão: HTTP 307 para `/login`.
- Webhook Meta com assinatura inválida: HTTP 401.
- Provedor Meta e credenciais obrigatórias presentes, verificados sem imprimir valores.
- Logs desde o start sem `error`, `exception`, `fatal` ou `panic`.
- Nenhuma mensagem ou reação real foi enviada durante a verificação.

## Funcionalidade publicada

- Envio, substituição e remoção de reação pela WhatsApp Cloud API oficial.
- Reações do cliente e ecos do aplicativo WhatsApp Business oficial.
- Reações rápidas `👍 ❤️ 😂 😮 😢 🙏`, seletor completo, teclado e toque longo.
- Identificação separada de `Cliente` e `XP`, estado otimista e tentativa manual segura.
- Limites da Meta reforçados no servidor: `wamid` confirmado, até 30 dias, mensagem não revogada e um único emoji Unicode.
- Reações não alteram leitura compartilhada, pendência de resposta, responsável ou status da mensagem original.
