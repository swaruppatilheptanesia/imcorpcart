// Check or re-run the recovery of gift cards the old flow lost by hand. It also runs
// by itself every time the backend starts (recoverMissingCards in
// voucher-fulfilment.service.ts, called from server.ts), so normally this is only
// for looking at what it would do. It NEVER buys, and never prints a card number or PIN.
//
//   Report only:  npm run vouchers:recover [-- --order=IMC-75804326]
//   Apply:        npm run vouchers:recover -- --apply [--order=IMC-75804326]
//
// Run from the production server: Hubble only accepts whitelisted IPs.

import { prisma } from '../src/config/prisma';
import { recoverMissingCards } from '../src/services/voucher-fulfilment.service';

const apply = process.argv.includes('--apply');
const orderNo = process.argv.find((a) => a.startsWith('--order='))?.slice('--order='.length);

console.log(apply ? 'APPLY' : 'Report only, nothing will change.');
recoverMissingCards({ apply, orderNo, log: console.log })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
