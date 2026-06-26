// Gera um hash bcrypt de uma senha — para montar a variável AUTH_USERS.
// Uso: npm run hash -- "minha-senha"
const bcrypt = require('bcryptjs');
const pw = process.argv[2];
if (!pw) {
  console.error('Uso: npm run hash -- "sua-senha"');
  process.exit(1);
}
console.log(bcrypt.hashSync(pw, 10));
