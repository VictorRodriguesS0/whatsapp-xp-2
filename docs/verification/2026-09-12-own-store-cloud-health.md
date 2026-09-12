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
- As 23 migrações existentes estão aplicadas no banco exclusivo de teste.
- Revisão independente sem achados de correção, segurança ou regressão.

As verificações na raiz excluíram as cópias de trabalho e artefatos locais: `node node_modules/vitest/vitest.mjs run --exclude '**/.worktrees/**' --exclude '**/data/**'` e `node node_modules/eslint/bin/eslint.js . --ignore-pattern '.worktrees/**' --ignore-pattern 'data/**'`. Foi mantido o aviso já existente da dependência `pg` sobre chamadas concorrentes a `client.query()`.

## Publicação

Ainda pendente nesta revisão documental. Registrar separadamente a revisão implantada, a saúde do servidor e o estado real do número; build e testes aprovados não significam reconexão do WhatsApp.
