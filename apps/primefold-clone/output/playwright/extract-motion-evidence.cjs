const fs=require('fs');const path=require('path');
const dir='assets/framerusercontent.com/sites/1C0xbF1SKgnQ0Z1nYjvdiv';
for(const name of ['HTf9k6GaR9eQKF9wF65IHmcajxJOM4P68Kfm7zuE6ac.BTPYc-b9.mjs','mkdyb58VB.Ox-SPixJ.mjs','Ll7zqaDS3.Bgs0mro2.mjs','Dot_Spinner.BnmYkkup.mjs']){
 const str=fs.readFileSync(path.join(dir,name),'utf8');
 fs.copyFileSync(path.join(dir,name),path.join('output/playwright',name));
 console.log(name, str.slice(0,1800));
}
