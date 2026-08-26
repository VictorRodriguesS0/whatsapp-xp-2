# Verificação de produção — Catálogo WhatsApp Release A

Data da implantação: 26 de agosto de 2026, horário de Brasília.

## Resultado

- Produção: `https://whatsapp.xpeletronicos.com`
- Página administrativa: `https://whatsapp.xpeletronicos.com/configuracoes/catalogo`
- Revisão implantada: `c6dd94e773ca5264d232014024aa9d62acf439e1`
- Imagem: `xp-whatsapp:c6dd94e773ca5264d232014024aa9d62acf439e1`
- ID imutável da imagem: `sha256:c4e5adf1827672d4fc2cf42197ec356d1112b07d12a82c2e3e1c34f41abf4ac2`
- Container final do app: `e7bcfe5b05298cc69f5f6b5aa353a84c97971cdf3a3a9277d7382cd55fbe5ffc`
- Container PostgreSQL preservado: `4804d7dee6031cd657b94ebca9a4bd6c945e364e02b4d974f848d399124ee585`
- Rollback app-only preservado: `xp-whatsapp:8514a44d8cea4fb912104a83c736938f2ab53168`
- Backup preventivo final: `/srv/backups/example-app/example-backup`

A Release A está implantada em modo seguro, somente leitura. Não existe endpoint de envio de produto. `WHATSAPP_CATALOG_ID` permanece deliberadamente sem valor até o catálogo correto ser positivamente identificado na Meta.

## Gates executados

- build Linux da revisão exata: aprovado;
- suíte completa em PostgreSQL 18 descartável: 219 arquivos aprovados, 1.935 testes aprovados e 2 integrações opcionais ignoradas;
- lint e TypeScript: aprovados;
- `npm audit --omit=dev`: 0 vulnerabilidades;
- verificadores de Compose, KVM e mutações de deploy: aprovados;
- runtime production-like com `WHATSAPP_CATALOG_ID=""`: health, login, API do catálogo, página do catálogo e conversas retornaram HTTP 200 com sessão administrativa;
- runtime como UID 1001, healthcheck da imagem e duas redes isoladas: aprovados;
- produção final: health local 200, health HTTPS 200, login 200, página do catálogo 200 e API anônima do catálogo 401;
- observação final: health `healthy`, zero reinícios e zero correspondências de erro nos logs.

## Incidentes controlados durante o rollout

A primeira candidata recusou `WHATSAPP_CATALOG_ID=""`, valor emitido pelo Compose quando o catálogo ainda não está configurado. O healthcheck falhou e o rollback automático restaurou a revisão anterior antes de promover o link ou o arquivo de ambiente. Um teste reproduziu a falha; a revisão final normaliza vazio ou espaços como “não configurado”, mantendo validação numérica para IDs presentes.

Na primeira tentativa da revisão corrigida, app, migrações e invariantes passaram, mas o verificador exigiu um redirecionamento HTTP tradicional da página protegida. O Next.js 16 respondeu 200 por seu fluxo de navegação server-side; o rollback conservador funcionou novamente. A terceira tentativa verificou a proteção pela API, que retornou 401 sem sessão, e foi promovida com sucesso.

## Auditoria de trabalho paralelo e invariantes

A revisão ativa anterior `8514a44d8cea4fb912104a83c736938f2ab53168` é ancestral da candidata. Todas as worktrees foram inspecionadas imediatamente antes do deploy. As branches limpas divergentes continham somente documentação e planos. A implementação paralela de funções de mensagens proativas permaneceu suja e incompleta em sua própria worktree; nenhum arquivo dela foi copiado ou alterado.

Somente `xp-whatsapp-app` foi recriado. PostgreSQL, Caddy, redes, volumes e containers de outros sistemas conservaram seus invariantes. O link `current`, `XP_WHATSAPP_IMAGE` e a imagem executada convergiram para a revisão final.

## Bloqueio de ativação na Meta

O WABA XP Eletrônicos é `108042165550725`, mas a conta possui vários catálogos e a associação exata não foi exposta pelas leituras permitidas. O token atual não possui `business_management`, e o usuário de sistema `xpatendimentoapi` não tem um catálogo atribuído. Por isso nenhum ID foi escolhido por suposição, a visibilidade do catálogo não foi alterada e o carrinho não foi modificado.

Para ativar a leitura real, é necessário identificar e compartilhar o WhatsApp Product Catalog correto com o usuário de sistema, conceder as permissões de catálogo/negócio exigidas pela Meta, regenerar o token preservando as permissões do WhatsApp e somente então definir `WHATSAPP_CATALOG_ID` na KVM. Depois disso, a página administrativa permite validar status, busca, imagens e atualização do cache sem habilitar envio de produto.
