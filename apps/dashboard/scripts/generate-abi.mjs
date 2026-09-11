import { readFile, writeFile } from 'node:fs/promises';
const check=process.argv.includes('--check');
for(const name of ['FacilityRegistry','CredentialRegistry','CoverageEngine','CovenantVault','MockUSDC']){
  const source=JSON.parse(await readFile(new URL(`../../../contracts/out/${name}.sol/${name}.json`,import.meta.url),'utf8'));
  const file=new URL(`../src/data/abi/${name}.json`,import.meta.url);
  const expected=JSON.stringify(source.abi,null,2)+'\n';
  if(check){if(await readFile(file,'utf8')!==expected)throw new Error(`${name} ABI drift: run pnpm --filter @fx-coverage/dashboard abi:generate`);}
  else await writeFile(file,expected);
}
