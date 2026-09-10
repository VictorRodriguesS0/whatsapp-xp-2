# Verificação da reconexão Meta

Data: 10/09/2026. Branch: `codex/meta-reconnection`.

## Escopo entregue

- Estado de conexão independente da qualidade do número e bloqueio de envios após desconexão confirmada.
- Embedded Signup v4 para o mesmo app, negócio, WABA e número, com administração autenticada, tentativas temporárias e validação no servidor.
- Interface em `/configuracoes/meta`, aviso sobre aparelhos adicionais e consulta de progresso.
- Duas migrações aditivas, cliente Prisma regenerado e novas variáveis repassadas pelos dois Compose.
- [Runbook de configuração, uso e reversão](../meta-reconnection.md).

## Verificações locais

`npm test`: 232 arquivos aprovados, 2 opcionais ignorados; 2.068 testes aprovados e 3 opcionais ignorados. Houve um aviso de depreciação do driver `pg`, sem falhas.

- PostgreSQL 18 isolado para testes; nenhuma migração ou seed executada no banco da loja.
- Testes novos reproduziram os defeitos antes das correções. Cobertura de callbacks em ambas as ordens, concorrência de tentativas, sessão, expiração, seleção de ativos, cancelamento durante troca, ausência de assinaturas, webhook durante consulta e reação interrompida antes do provedor.
- Revisão independente encontrou quatro defeitos; todos corrigidos e revisados novamente sem bloqueios restantes.
- Build Next.js de produção, TypeScript, ESLint e validação do schema aprovados.
- Verificadores existentes `verify-kvm-deployment.ps1` e `test-deployment.ps1` aprovados.
- Migrações aplicadas no banco local; segunda execução não encontrou migrações pendentes.
- Navegador autenticado com dados fictícios: badge “WhatsApp desconectado”, qualidade “Normal” separada, reconexão desabilitada sem configuração e preservação da desconexão após falha de atualização. Sem erros de console.
- SDK/callbacks e jornada habilitada verificados com simulações em testes; o onboarding real ainda depende dos requisitos externos abaixo.

## Implantação em produção

Após autorização do responsável, a [PR #1](https://github.com/VictorRodriguesS0/whatsapp-xp-2/pull/1) foi integrada em `main` no commit `7ebf50e`. A imagem publicada contém a revisão `2e482a0`, cuja árvore é idêntica à do merge.

- Imagem Linux construída a partir de `git archive`, com revisão OCI conferida e hashes de transferência e imagem validados no servidor.
- Teste da imagem com PostgreSQL 18 descartável, dados fictícios e sessão administrativa: saúde, autenticação, página de configuração e bloqueio da reconexão desabilitada verificados.
- Backup do banco e das mídias validado antes da implantação. As duas migrações aditivas foram aplicadas: 23 migrações concluídas, nenhuma falha. Não houve seed ou reset em produção.
- Somente o container da aplicação foi recriado. IDs, imagens, início de execução e estado dos demais containers permaneceram iguais; redes e volumes da aplicação foram preservados.
- Verificação após implantação e configuração em 10/09/2026, 19:16 UTC: saúde e login HTTP 200; API de reconexão anônima HTTP 401; zero reinícios, OOM ou erros nos logs do container atual.
- A sessão administrativa existente abriu a nova tela. A atualização real confirmou `DISCONNECTED`, exibiu o alerta crítico e suspendeu novos envios pela central.

## Configuração Meta e limites atuais

Com autorização explícita do responsável, foram aceitos os Termos de Provedor de Tecnologia e iniciado o cadastro como provedor independente no aplicativo existente. O configurador passou a permitir uma configuração de **WhatsApp Embedded Signup**, que foi criada. O domínio HTTPS da central foi autorizado e o login pelo JavaScript SDK está habilitado.

O `config_id`, o negócio proprietário e a versão do SDK estão configurados somente no ambiente protegido do servidor. A flag `META_EMBEDDED_SIGNUP_ENABLED` permanece `false`, pois o configurador exige concluir a verificação da empresa e as aprovações aplicáveis antes do uso em produção. A análise do app ainda possui uma solicitação não enviada, com exigência de demonstração, instruções para o analista e informações de tratamento de dados.

Foram preparados rascunhos factuais para as permissões de mensagens e gerenciamento, descrevendo a operação da própria loja. A Meta indica o teste de gerenciamento como concluído; o teste de envio ainda está pendente. A demonstração completa e o teste de envio dependem da conexão e de um destinatário autorizado. Não foi enviada a solicitação de análise nem confirmadas declarações de tratamento de dados.

A verificação empresarial foi iniciada com o CNPJ informado pelo responsável. A Meta encontrou um registro correspondente ao nome e endereço já cadastrados e passou a exigir documento de identidade de um representante listado nesse registro. A etapa foi deixada aberta para conclusão pelo responsável; nenhum documento pessoal foi enviado. Isso ainda não equivale à aprovação da empresa.

A consulta dos ativos confirmou o mesmo negócio, número e aplicativo, com as assinaturas necessárias presentes. A última leitura direta do número retornou `DISCONNECTED`, `platform_type=ON_PREMISE` e `is_on_biz_app=true`; a Cloud API ainda não está reconectada. A verificação posterior no banco confirmou a desconexão e nenhuma tentativa de Embedded Signup iniciada.

As credenciais permanentes, o número e a WABA foram preservados. Não houve nova assinatura, onboarding do número, envio de mensagem a clientes ou reconexão de celular durante a implantação. Não há alegação de que as desconexões diárias dos aparelhos adicionais foram resolvidas.
