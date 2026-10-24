# Minhas Finanças

## Executar localmente

1. Use Node.js 24 ou superior e execute `npm install`.
2. Copie `.env.example` para `.env` e configure as credenciais da aplicação Pluggy no servidor.
3. Execute `npm run dev` nesta pasta.
4. Abra `http://127.0.0.1:4173` e crie uma conta para cada usuário.

No desenvolvimento local, o servidor usa SQLite em `.local/finance.sqlite`. Na Vercel, usa Neon Postgres a partir de `DATABASE_URL`; o schema é criado durante a inicialização. Os dados financeiros e as conexões ficam associados ao identificador do usuário autenticado. As tabelas compartilhadas aplicam isolamento pelo `user_id` nas operações do servidor.

Na primeira inicialização após a migração, a conta anterior em `.local/auth.json` é copiada para o banco. Os cartões, transações, renda, custos fixos, investimentos e saldos que estavam no armazenamento do navegador da conta original são importados no primeiro acesso autenticado dessa conta. As conexões antigas de corretora e Pluggy também são atribuídas à conta original. Mantenha o mesmo endereço e porta do navegador durante essa importação.

As chaves da Binance são cadastradas individualmente no painel **Contas** e criptografadas com AES-256-GCM antes de serem armazenadas no banco. A chave de criptografia local fica em `.local/app-encryption.key`; esse diretório é ignorado pelo Git. Na Vercel, configure uma chave estável `APP_ENCRYPTION_KEY` em Base64 com 32 bytes. Nunca compartilhe `.local`, `.env` ou a chave de criptografia.

As credenciais `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` pertencem à aplicação e ficam no servidor. O servidor gera Connect Tokens vinculados ao usuário autenticado; cada item conectado é salvo sob o respectivo usuário. A Pluggy envia `clientUserId` como identificador externo do usuário em cada item.

O primeiro usuário existente é migrado da autenticação antiga e mantém sua senha. Novos usuários podem criar contas pelo botão de cadastro. Cada usuário tem suas próprias transações, cartões, investimentos e chaves Binance.

O servidor escuta somente `127.0.0.1` por padrão fora da hospedagem. Na Vercel, use Neon para persistência, mantenha os segredos em variáveis de ambiente e configure um domínio HTTPS antes de divulgar a aplicação.

## Deploy na Vercel

O projeto Vercel `meu_controle_financeiro` usa Node.js 24 e reconhece `server.ts` como ponto de entrada. A configuração `vercel.json` habilita Fluid Compute. O repositório precisa conter os arquivos do app e estar conectado a esse projeto Vercel.

1. Instale Neon Postgres pelo Marketplace da Vercel e conecte o banco ao projeto. A integração fornece `DATABASE_URL`.
2. Configure `APP_ENCRYPTION_KEY`, `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` como segredos nos ambientes de produção e preview. Configure `PLUGGY_WEBHOOK_SECRET` se usar webhooks.
3. A Vercel fornece HTTPS e `VERCEL_URL`. Para domínio próprio, configure `PUBLIC_ORIGIN` com a origem HTTPS exata, sem caminho nem barra final.
4. Conecte o repositório GitHub vazio `ajsmorais88-prog/Meu_controle_financeiro` e publique o branch principal para iniciar o deploy.
5. O deploy cria um banco novo. A base `.local/finance.sqlite`, credenciais Pluggy/Binance e dados do navegador local não são enviados automaticamente; exporte os dados que deseja manter e importe-os pela conta correspondente.

O login e os limites de tentativas ficam armazenados no Postgres, para funcionar entre instâncias da Vercel. Não use o SQLite local em produção.

### Recuperação por e-mail

O cadastro solicita um e-mail. O usuário pode verificar ou atualizar esse endereço em **E-mail da conta** no painel. A redefinição envia um código de 8 dígitos, válido por 15 minutos e limitado a cinco tentativas. O código de recuperação criado no cadastro continua disponível como alternativa.

Para enviar mensagens, configure `RESEND_API_KEY` como segredo e `EMAIL_FROM` como remetente autorizado pelo Resend nos ambientes Production e Preview da Vercel. O domínio do remetente precisa estar verificado no Resend. Contas antigas começam sem e-mail associado; elas precisam continuar autenticadas para cadastrar e verificar um endereço. Se o usuário também perdeu o código de recuperação, não existe um modo seguro de associar um e-mail sem validar a identidade da conta.

## Webhooks Pluggy

O servidor recebe `item/created`, `item/updated` e `item/error` em `POST /api/webhooks/pluggy`. Defina `PLUGGY_WEBHOOK_SECRET` no `.env` e cadastre na Pluggy um webhook HTTPS público para `/api/webhooks/pluggy` com o header `X-Webhook-Secret`. A Pluggy envia o `clientUserId` definido no Connect Token; o servidor usa esse identificador para vincular o evento ao usuário.
