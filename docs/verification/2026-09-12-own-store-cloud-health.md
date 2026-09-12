# Diagnóstico da Cloud API para uso interno — 12/09/2026

## Alteração

O diagnóstico de saúde reconhece uma conexão direta verificada da Cloud API, mesmo quando `is_on_biz_app=false`. Exige número conectado, plataforma Cloud API, estado do aplicativo conhecido, assinatura do aplicativo correto na WABA e eventos `messages` e `account_update` ativos. Números em coexistência continuam exigindo os eventos adicionais de sincronização.

A confirmação de tentativas do Embedded Signup mantém a exigência de coexistência. Uma conexão apenas de API não conclui essas tentativas. Evidências incompletas ou antigas não liberam envios após uma desconexão confirmada.

Não há migrações, troca de credenciais, registro de números ou mudança na configuração Meta. O erro externo `2655111` do onboarding existente não é resolvido por esta correção. O rascunho de App Review foi adiado a pedido do responsável.

## Verificação anterior à publicação

- Regressão reproduzida na classificação de conexão; os cinco casos de assinatura da API direta falharam ao restaurar temporariamente a condição antiga e passaram com a correção.
- 93 testes dos módulos afetados passaram, incluindo integração com PostgreSQL e proteção dos envios.
- Suíte completa: **2.081 testes aprovados**, 3 testes opcionais ignorados; 232 arquivos aprovados, 2 ignorados.
- Build de produção, TypeScript, ESLint e verificadores de Compose e implantação KVM aprovados.
- Imagem Linux compilada e testada com o mesmo usuário e limites de recursos de produção: saúde e login retornaram HTTP 200; a rota administrativa sem sessão retornou HTTP 401. O contêiner ficou saudável, sem reinícios.
- As 23 migrações existentes estão aplicadas no banco exclusivo de teste.
- Revisão independente sem achados de correção, segurança ou regressão.

As verificações na raiz excluíram as cópias de trabalho e artefatos locais: `node node_modules/vitest/vitest.mjs run --exclude '**/.worktrees/**' --exclude '**/data/**'` e `node node_modules/eslint/bin/eslint.js . --ignore-pattern '.worktrees/**' --ignore-pattern 'data/**'`. Foi mantido o aviso já existente da dependência `pg` sobre chamadas concorrentes a `client.query()`.

## Publicação

Correção integrada pelo [PR #2](https://github.com/VictorRodriguesS0/whatsapp-xp-2/pull/2). Revisão implantada: `faa4b4397719683f78ab0eaa1268dfa0f71ea22d`.

Verificação em 12/09/2026, às 00:25 no horário de Brasília:

- Artefatos e camadas da imagem conferidos; backup preventivo do banco e da mídia validado.
- Aplicação saudável, sem reinícios, falhas por memória ou sinais de erro nos logs desde a inicialização.
- Saúde e login públicos retornaram HTTP 200; a rota administrativa sem autenticação retornou HTTP 401.
- As 23 migrações existentes continuam aplicadas, sem falhas. Banco, redes, volumes e demais contêineres permaneceram preservados na janela da atualização.
- A primeira tentativa de publicação foi interrompida antes de alterar a aplicação porque outro projeto havia sido atualizado no servidor. Após confirmar os novos contêineres saudáveis e estáveis, foi registrado um novo estado de referência e a publicação prosseguiu.
- A configuração de Embedded Signup permanece desabilitada e nenhuma tentativa de onboarding foi criada.

A consulta independente à Meta confirmou o mesmo número configurado com `DISCONNECTED`, `ON_PREMISE` e `is_on_biz_app=true`. O diagnóstico persistido também informa `DISCONNECTED`. A correção está publicada, mas a reconexão do número da loja em coexistência continua dependente da resolução do bloqueio externo da Meta.
