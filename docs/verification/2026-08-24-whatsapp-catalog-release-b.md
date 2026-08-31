# Verificação da Release B do catálogo do WhatsApp

Data da implantação: 31 de agosto de 2026  
Produção: `https://whatsapp.xpeletronicos.com`  
Revisão implantada: `6a301af5f2f993f093d4f778879e142963bc2102`

## Escopo implantado

- consulta autenticada e sanitizada ao catálogo oficial da Meta;
- seleção e revisão de um produto, lista de até 30 produtos e catálogo completo;
- envio pelos formatos interativos oficiais, com catálogo e metadados definidos somente no servidor;
- reutilização das regras existentes de janela de 24 horas, restrição de contato, idempotência, retry e estados de entrega;
- cartões persistidos a partir de uma fotografia sanitizada, sem expor token ou identificador completo do catálogo.

## Auditoria antes da implantação

- A revisão de produção anterior, `fc015120fd6e1445e29d6db71f0e47f11f9b45bd`, é ancestral da candidata.
- A candidata contém a linha principal e todas as funcionalidades paralelas já concluídas e revisadas.
- O trabalho proativo ainda não concluído permaneceu preservado em seu próprio worktree e não foi misturado nesta release.
- O pacote imutável teve SHA-256 `c8823c5c7feb3c56eaf01704aa95c9ec56dadc9b3f21da1a90ca6311e4252858` tanto localmente quanto na KVM.
- A imagem `xp-whatsapp:6a301af5f2f993f093d4f778879e142963bc2102` teve ID `sha256:9389bd6ae79fd8fefd0fbf66a315b637034ef697dbd874f018f8729757607add` e label OCI de revisão correspondente.

## Verificações executadas

- suíte completa em Linux: 225 arquivos aprovados e 2 opcionais ignorados; 2010 testes aprovados e 2 opcionais ignorados;
- migrations aplicadas em PostgreSQL 18 descartável e integração focada do catálogo aprovada;
- build de produção do Next.js aprovado na KVM;
- `npm run lint`, `npm run typecheck`, `npm run db:validate`, testes de mutação de implantação, verificações de Compose e KVM aprovados;
- auditoria das dependências de runtime: 0 vulnerabilidades;
- imagem final construída após os testes e sem dependências de desenvolvimento no runtime.

## Backup e implantação controlada

- Backup validado em `/srv/backups/example-app/example-backup`.
- Somente o contêiner `xp-whatsapp-app` foi recriado com `--no-deps --force-recreate --wait`.
- O link `current` passou atomicamente para `/opt/apps/example-app/releases/6a301af5f2f993f093d4f778879e142963bc2102` somente depois do healthcheck saudável.
- A imagem e a release anteriores foram preservadas para rollback.

## Invariantes da KVM

Antes e depois da implantação:

- banco: mesmo ID `4804d7dee6031cd657b94ebca9a4bd6c945e364e02b4d974f848d399124ee585`, mesmo início `2026-08-22T23:57:15.699997655Z`, saudável e sem reinício;
- contêineres fora da aplicação: 30, com assinatura estável `931950545bc7bd0011c2995911241b5a19bdfb26c4ae092a9d52d08aab5a4de1`;
- redes: assinatura estável `7dbeaab97acbaaaba16bddb54e6d8ce062731f403786267df0c2bf8336035bf1`;
- volumes: assinatura estável `197e21146aed463bdd861f11af16d8b126551803ed0d1458078f4a14577eaddf`.

A aplicação passou a usar o contêiner `e703ced5b48be57d3e25684eb0016957914dcd141f1a610ebf1251bb756cfe7d`, com a imagem e a revisão esperadas, status saudável, zero reinícios e sem OOM.

## Aceite técnico de produção

- health local: HTTP 200;
- health público: HTTP 200;
- login: HTTP 200;
- consulta anônima de produtos: HTTP 401;
- tentativa anônima de envio do catálogo, sem entrega à Meta: HTTP 401;
- webhook com assinatura inválida: HTTP 401;
- logs recentes do contêiner: nenhuma linha de erro fatal;
- interface de conversas reconectada depois do reload e sem erros de console;
- diagnóstico administrativo: **Pronto para uso**, catálogo `CATALOGO SITE XP`, 89 produtos, visível no WhatsApp, carrinho ativo e dados atualizados.

Nenhuma mensagem foi enviada a cliente durante o aceite técnico. O aceite funcional manual ainda deve usar um destino controlado pela XP e uma conversa dentro da janela de atendimento para confirmar, nesta ordem, um produto, uma lista curta e o catálogo completo; em seguida deve ser feito um smoke test de texto, áudio e mídia.
