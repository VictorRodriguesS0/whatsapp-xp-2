# Ativação do catálogo oficial do WhatsApp em produção

- Data: 2026-08-29
- Domínio: `https://whatsapp.xpeletronicos.com`
- Revisão implantada: `fc015120fd6e1445e29d6db71f0e47f11f9b45bd`
- Imagem: `xp-whatsapp:fc015120fd6e1445e29d6db71f0e47f11f9b45bd`
ID da imagem: `sha256:e6e9f638deb22c7117e35676ac9edd27ca4b1d5a5728141e523aaa011ebefd7d`

## Resultado

O catálogo oficial `CATALOGO SITE XP` está conectado ao número da XP Eletrônicos e disponível na aplicação de produção. A leitura final da API oficial da Meta retornou 61 produtos em estoque, catálogo visível e carrinho ativo. A contagem anterior de 62 mudou no próprio Commerce Manager: tanto o campo `product_count` quanto a paginação completa do endpoint de produtos retornaram 61 no momento da ativação final.

Na página administrativa autenticada, a aplicação mostrou `Pronto para uso`, `61 produtos`, `Visível no WhatsApp`, `Carrinho ativo` e `Atualizado`.

## Correções incluídas

Dois limites independentes de descrição impediam que o catálogo real fosse usado:

1. O servidor recusava descrições reais acima de 2.000 caracteres.
2. O cliente repetia o mesmo limite e mostrava `Resposta de catálogo inválida` mesmo depois da correção do servidor.

O limite compartilhado passou a ser 10.000 caracteres e foi centralizado para que servidor e cliente usem o mesmo contrato. As regressões cobrem descrições reais de 2.247 e 2.278 caracteres.

## Gates da revisão exata

- suíte completa dentro da imagem Linux candidata, com PostgreSQL 18 isolado: 219 arquivos aprovados, 2 ignorados; 1.937 testes aprovados, 2 ignorados; saída 0;
- lint, typecheck, build e validadores de deployment/Compose/KVM: aprovados;
- auditoria de dependências de produção: zero vulnerabilidades;
- arquitetura `amd64` e label OCI apontando para a revisão exata: confirmadas;
- smoke isolado: todas as migrations aplicadas, runtime saudável, zero reinícios, sem OOM, UID/GID `1001:1001`, FFmpeg, FFprobe e PDFInfo disponíveis;
- endpoints isolados: health 200, login 200 e catálogo anônimo 401;
- todos os contêineres, bancos e redes descartáveis foram removidos depois dos testes.

## Deploy e preservação da KVM

O deploy recriou somente o serviço `xp-whatsapp-app`, usando `--no-deps`. Nenhum outro serviço foi recriado.

- contêiner final da aplicação: `a8894ddc9dc2c2dddeff5aa2ebac613d99ae0701cbfeeaa471394940d8c1ed28`;
- imagem final saudável, zero reinícios e sem OOM;
- banco preservado com o mesmo ID `4804d7dee6031cd657b94ebca9a4bd6c945e364e02b4d974f848d399124ee585` e o mesmo `StartedAt` de `2026-08-22T23:57:15.699997655Z`;
- fotografia dos 30 contêineres não relacionados à aplicação: idêntica antes e depois;
- volumes `xp_whatsapp_media` e `xp_whatsapp_postgres`: preservados;
- redes `xp_whatsapp_egress` e `xp_whatsapp_internal`: preservadas;
- `current`, ambiente e imagem em execução convergem para a revisão final;
- health HTTPS e login público: 200.

Backups criados antes das promoções:

- `/srv/backups/example-app/env-production-before-catalog-20260829T025014Z`;
- `/srv/backups/example-app/example-backup`;
- `/srv/backups/example-app/env-production-before-catalog-code-20260829T152438Z`;
- `/srv/backups/example-app/example-backup`;
- `/srv/backups/example-app/env-production-before-catalog-client-20260829T161155Z`.

A revisão/imagem anterior `8e0e7be73a72c3317b424e759d3d86fccc6df45a` permanece disponível para rollback.

## Verificação autenticada no navegador

O seletor de produtos foi aberto em uma conversa apta, sem selecionar produto e sem enviar mensagem.

- o erro `Resposta de catálogo inválida` não apareceu;
- a busca por `Xiaomi` retornou resultados;
- a paginação exibiu 20, 40, 60 e finalmente os 61 produtos;
- as 61 imagens de produto presentes no DOM ficaram completas, com dimensões válidas e zero imagens quebradas;
- a página `/configuracoes/catalogo` confirmou nome, quantidade, visibilidade, carrinho e atualização dos dados;
- o navegador foi deixado na página administrativa do catálogo.

## Trabalho paralelo

Foram auditados 11 worktrees imediatamente antes do deploy. A candidata estava limpa. O worktree `codex/whatsapp-quoted-replies` continuava com 17 arquivos do trabalho paralelo de templates; nenhum deles foi copiado, mesclado ou alterado. Os demais worktrees funcionais permaneceram limpos. Os diretórios não rastreados `.superpowers/` e `node_modules/` já existentes em duas árvores também foram preservados.
