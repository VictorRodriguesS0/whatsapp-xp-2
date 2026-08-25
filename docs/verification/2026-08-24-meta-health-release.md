# Verificação do release de saúde operacional da Meta

Data: 2026-08-24

## Resultado

A funcionalidade de saúde operacional da Meta está publicada e saudável em produção.

- Release ativa: `cd0c5bbe2fa9254baa30c6178c91512ce577ce2f`.
- Imagem imutável: `xp-whatsapp:cd0c5bbe2fa9254baa30c6178c91512ce577ce2f`.
- Image ID: `sha256:3be34ca46a6e72789b7664bddd0a9e464f31751be8aa0c12e668eebc968fa8e4`.
- Release anterior preservada para rollback app-only: `41b8ac6ada5babfc6e280bb131d792baad6bf984`.
- Backup preventivo validado: `/srv/backups/example-app/example-backup`.
- Backup do arquivo de ambiente anterior: `/opt/apps/example-app/.env.production.backup`.

## Auditoria dos trabalhos paralelos

O preflight foi repetido durante a preparação, imediatamente antes do backup e imediatamente antes do rollout.

- A produção mudou de `2f8f865…` para `41b8ac6…` durante os gates. O primeiro candidato foi descartado antes de qualquer deploy.
- O release `41b8ac6…`, com visualização e miniaturas de PDF, foi mesclado integralmente. Ele é o segundo ancestral direto da release publicada.
- A linha de políticas/templates ainda tinha interface e resumptions não commitados e não foi copiada pela metade.
- A linha de sincronização completa continuava fora da produção. Antes do rollout ela já havia incorporado este release Meta, evitando que um deploy futuro dessa linha apague a funcionalidade.
- Nenhum arquivo não commitado de outra worktree foi alterado.

## Gates locais e do artefato

- Schema Prisma válido, lint e typecheck: aprovados.
- Suíte consolidada: 160 arquivos aprovados, 2 opcionais ignorados; 1.421 testes aprovados e 3 opcionais ignorados.
- Build Next.js de produção: aprovado com as rotas administrativas e APIs Meta, além da rota de miniatura PDF preservada.
- Verificadores de Compose, KVM e testes de mutação do deploy: aprovados.
- Validação visual autenticada em desktop e viewport 390×844: badge discreto, página responsiva e redirecionamento de atendente não administrador aprovados, sem erros de console.
- Build Linux limitado a 0,5 CPU, 2 GiB de RAM e 3 GiB incluindo swap, sem OOM.
- Smoke isolado na KVM: health e login 200, migration Meta aplicada uma vez, processo sem restart/OOM, FFmpeg, FFprobe e Poppler presentes, sem `.env` de runtime nem testes da aplicação na imagem.

## Rollout e infraestrutura

O primeiro start candidato ficou saudável, mas um verificador de redes usou `\\n` literal e gerou falso negativo. O rollback automático restaurou `41b8ac6…` saudável antes de qualquer promoção de symlink ou arquivo de ambiente. O comando de inspeção foi corrigido para usar quebras reais; não houve mudança de código ou de banco para a segunda tentativa.

Na tentativa final:

- somente `xp-whatsapp-app` foi recriado;
- o container PostgreSQL permaneceu `4804d7dee6031cd657b94ebca9a4bd6c945e364e02b4d974f848d399124ee585`;
- o hash determinístico de todos os containers não-app permaneceu `384a74a2886d7ae87e651d89e59e214ec7c60836e81072beb606519dc6a8a2d4`;
- o agregado de migrations terminou em `18/0/0` (concluídas/incompletas/rollback);
- `202608230003_meta_health` terminou em `1/0/0`;
- o app roda como `1001:1001`, nas três redes esperadas, com zero reinícios;
- `current`, `XP_WHATSAPP_IMAGE` e a imagem do container ficaram alinhados à revisão ativa;
- assinatura Meta inválida retornou HTTP 401;
- APIs administrativas sem sessão retornaram HTTP 401;
- três amostras de soak, separadas por 20 segundos, ficaram saudáveis e sem erros de log;
- não restaram builders, bancos, redes ou apps temporários do smoke.

## Meta Graph API e webhooks

A leitura real e sanitizada da Graph API retornou qualidade `GREEN` para o número e revisão `APPROVED` para a conta. A consulta de templates retornou zero templates no momento do release.

A assinatura `whatsapp_business_account` do aplicativo já contém os campos operacionais necessários:

- `account_update`;
- `account_review_update`;
- `phone_number_quality_update`;
- `phone_number_name_update`;
- `message_template_status_update`.

Os campos existentes `messages`, `smb_message_echoes` e `smb_app_state_sync` também continuam assinados. Nenhuma assinatura, número, token ou configuração da Meta foi modificada durante este rollout.

## Rollback

O rollback imediato é app-only para a release e imagem `41b8ac6ada5babfc6e280bb131d792baad6bf984`. A migration Meta é aditiva e compatível com o binário anterior; não deve ser revertida. Banco, mídia, Caddy, DNS, redes, volumes, assinatura Meta e outros sistemas não devem ser recriados.
