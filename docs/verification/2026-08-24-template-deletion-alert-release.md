# Alerta de template excluído da Meta — verificação de produção

Data da implantação: 25 de agosto de 2026

## Resultado

A reconciliação completa da Graph API agora encerra alertas
`TEMPLATE_PENDING_DELETION` quando o template não aparece mais na listagem
oficial. Falhas ou respostas incompletas da Meta continuam preservando o alerta
ativo. Um webhook explícito com estado `DELETED` também encerra o mesmo alerta.

O alerta de produção `ab116d94-a6f0-454b-809b-c582eb77b54b` foi resolvido sem
exclusão de histórico:

- recurso Meta: `2126281431294415`;
- ocorrência: `2026-08-25 00:09:05 UTC`;
- estado anterior: ativo, sem `resolved_at`;
- estado final: inativo;
- resolução: `2026-08-25 03:50:54.377 UTC` (`00:50:54.377` em Brasília);
- alertas operacionais ativos após a reconciliação: zero.

## Revisão, concorrência e artefato

- Revisão publicada: `3d2a350cfe7814da22189dd8dae5410076162d9d`.
- Imagem imutável: `xp-whatsapp:3d2a350cfe7814da22189dd8dae5410076162d9d`.
- Image ID: `sha256:9abb398373d2fc7c11a969a19506a64b1cfc4cc6602b34364ada9dbe6261d649`.
- Release anterior e rollback imediato: `4d1c2e3dcf7ee898c88c38e2e8841aa8b5ffa05b`.
- Image ID de rollback: `sha256:eab51c028822c07732253879e5159e9dae8309aa522fb8632100aed31a1cbb96`.

O preflight bloqueou uma primeira candidata porque a produção mudou de
`bdb6d758…` para `4d1c2e3…` enquanto a imagem era construída. A nova produção,
que contém o player de áudio oficial da central, foi integrada integralmente; os
testes de Meta e áudio foram executados juntos antes de uma nova imagem ser
gerada. Alterações não commitadas de acabamento visual em outra worktree não
foram copiadas nem modificadas.

A candidata intermediária `5ef4de24…` nunca foi publicada. Sua tag Docker e os
archives de transporte foram removidos; a pasta de fonte correspondente ficou
preservada porque a política de segurança recusou remoção recursiva automática.

## Gates locais e do artefato

- Testes focados finais de Meta e áudio: 7 arquivos e 98 testes aprovados.
- Suíte completa final: 199 arquivos aprovados e 2 ignorados; 1.735 testes
  aprovados e 3 ignorados pelas flags existentes.
- Prisma validate/generate e aplicação das 20 migrations em banco vazio:
  aprovados.
- ESLint, TypeScript e `git diff --check`: aprovados.
- Build Next.js: aprovado com 32 páginas e todas as rotas existentes.
- Testes de mutação do deploy e verificadores Compose/KVM: aprovados.
- Auditoria de dependências de produção: zero vulnerabilidades.
- Imagem Linux/amd64: build aprovado, runtime não-root `1001:1001`, FFmpeg,
  FFprobe e Poppler presentes, sem testes da aplicação ou arquivos `.env`.
- Smoke isolado: health/login HTTP 200, migrations `20/0`, zero reinícios e
  limpeza integral de app, banco e rede temporários.

## Backup e rollout

- Backup validado:
  `/srv/backups/example-app/example-backup`.
- SHA-256 do banco:
  `cd8e004b8c2e1d09c6a8ceae569175146d17bfaf7da69b24a5997e66315fe72d`.
- SHA-256 da mídia:
  `d725eea5fbc48c1e27c7daa75f87494d86c64c1e0675c7048ec255e97f96059e`.
- Cópia do ambiente anterior:
  `/opt/apps/example-app/.env.production.backup`.
- Novo app:
  `9839a7b781d7396e1573372c5dcb56af649c3cb147551203de125212426704a4`.
- Banco preservado:
  `4804d7dee6031cd657b94ebca9a4bd6c945e364e02b4d974f848d399124ee585`.
- Migrations de produção: `20/0/0` concluídas/incompletas/revertidas.

Somente `xp-whatsapp-app` foi recriado. O PostgreSQL manteve o mesmo container,
data de início, health e zero reinícios. O snapshot filtrado dos 30 containers
não-app permaneceu idêntico antes e depois, com SHA-256
`b4a3caf9df607b14fc74b963d41302ba0ad0607444b14f40e3f1975980443021`.
Uma primeira comparação incluiu indevidamente o próprio app por misturar ID
Docker curto e completo; a comparação corrigida filtra pelo nome canônico e
provou que nenhum container não-app mudou.

`current`, `XP_WHATSAPP_IMAGE`, a imagem do container e o label OCI ficaram
alinhados à revisão publicada. O app permaneceu nas redes `shared_gateway`,
`xp_whatsapp_egress` e `xp_whatsapp_internal`.

## Prova Meta e comportamento funcional

Antes do rollout, a Graph API retornou HTTP 200 para a lista completa, uma
página e um template atual. O ID antigo não estava presente. A consulta direta
ao recurso antigo retornou HTTP 400/código Meta 100, confirmando que o objeto já
não existe ou não está acessível para a conta.

Depois do rollout, uma sincronização forçada e autenticada retornou HTTP 202,
`status=SYNCED` e `success=true`. A sessão administrativa temporária foi removida
no encerramento e a auditoria encontrou zero sessão curta de verificação. Uma
nova leitura sanitizada da Graph API continuou retornando HTTP 200, um template
atual e ausência do ID antigo.

A política oficial permaneceu `ACTIVE`, versão `1`, com sincronização de
templates `SUCCEEDED`. A atribuição de retomada permaneceu inalterada:

- função: `SERVICE_RESUMPTION`;
- template: `continuacao_atendimento_solicitado` (`1068375312443492`);
- idioma/categoria: `pt_BR` / `UTILITY`;
- estado: `APPROVED`, suportado, um parâmetro.

## Aceite e estabilidade

Três amostras separadas por 20 segundos confirmaram:

- health público e local HTTP 200;
- login público HTTP 200;
- app e banco `running/healthy`, zero reinícios;
- zero marcador fatal, unhandled, P3009, migration failure ou HTTP 5xx nos logs
  desde o início da release.

A API administrativa sem sessão e um webhook Meta com assinatura inválida
retornaram HTTP 401. Nenhuma mensagem real foi enviada, nenhum template foi
criado/alterado e nenhuma assinatura, número, token, Caddy, DNS, rede ou volume
foi modificado.

## Rollback

O rollback é app-only. Restaure o arquivo de ambiente preservado, aponte
`current` para `4d1c2e3dcf7ee898c88c38e2e8841aa8b5ffa05b` e recrie somente o
serviço `app` com `--no-deps --force-recreate --wait`. Não restaure o banco: esta
release não adicionou migration e o histórico de alerta é compatível com a
imagem anterior. Não recrie PostgreSQL, mídia, redes, Caddy, DNS, assinatura Meta
ou outros serviços da KVM.
