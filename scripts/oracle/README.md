# Deploy de produção em Oracle Free VM

Arquivos deste diretório:

- `setup-vm.sh`: prepara servidor Oracle Linux 9, Ubuntu ou Debian (Node 20, PM2, Nginx, firewall)
- `deploy.sh`: atualiza código, instala dependências, gera build e recarrega PM2
- `pm2.ecosystem.config.cjs`: configuração padrão do processo `autozap-api`
- `nginx-autozap.conf.example`: reverse proxy HTTP para a API local (`127.0.0.1:3000`)

Uso rápido:

```bash
sudo bash ./scripts/oracle/setup-vm.sh
APP_DIR=/opt/autozap BRANCH=main bash ./scripts/oracle/deploy.sh
```

Depois do Nginx ativo:

```bash
sudo certbot --nginx -d api.seudominio.com
```
