const firebaseConfig = {
  apiKey: "AIzaSyBzuJkT4Xi-GbLsyNZs7WSqQLPditJQ0Do",
  authDomain: "finance-tracker-c85f8.firebaseapp.com",
  projectId: "finance-tracker-c85f8",
  storageBucket: "finance-tracker-c85f8.firebasestorage.app",
  messagingSenderId: "555889482457",
  appId: "1:555889482457:web:c2ce8e03694c38ce747cc8",
  measurementId: "G-HV5LDL0C46"
};


const LOCAL_KEY = "moneybag_data";

let state = {
user:null,
items:[]
};

let auth;
let db;

function initFirebase(){

const fb = window.firebaseSDK;

const app = fb.initializeApp(firebaseConfig);

auth = fb.getAuth(app);
db = fb.getFirestore(app);

fb.onAuthStateChanged(auth,(user)=>{
if(user){
state.user=user;
showApp();
loadData();
}else{
showAuth();
}
});
}

function saveLocal(){
localStorage.setItem(LOCAL_KEY,JSON.stringify(state.items));
}

function loadLocal(){
const raw=localStorage.getItem(LOCAL_KEY);
if(raw){
state.items=JSON.parse(raw);
}
}

async function syncCloud(){

if(!navigator.onLine || !state.user) return;

const fb = window.firebaseSDK;

try{

const snap = await fb.getDocs(
fb.collection(db,"users",state.user.uid,"entries")
);

state.items=[];

snap.forEach((d)=>{
state.items.push({
id:d.id,
...d.data()
});
});

saveLocal();
render();

}catch(err){
console.log(err);
}
}

async function addEntry(){

const title=document.getElementById("title").value;
const amount=parseFloat(document.getElementById("amount").value);
const type=document.getElementById("type").value;

if(!title || !amount){
alert("Fill all fields");
return;
}

const item={
title,
amount,
type,
createdAt:new Date().toISOString()
};

state.items.unshift(item);

saveLocal();
render();

if(navigator.onLine && state.user){

const fb = window.firebaseSDK;

try{
await fb.addDoc(
fb.collection(db,"users",state.user.uid,"entries"),
item
);
}catch(err){
console.log(err);
}
}

document.getElementById("title").value="";
document.getElementById("amount").value="";
}

function render(){

const history=document.getElementById("history");

let balance=0;

history.innerHTML="";

state.items.forEach((item)=>{

if(item.type==="add"){
balance+=item.amount;
}else{
balance-=item.amount;
}

history.innerHTML += `
<div class="entry ${item.type}">
<strong>${item.title}</strong><br>
${item.type==="add" ? "+" : "-"}৳${item.amount}
</div>
`;
});

document.getElementById("balance").innerText="৳"+balance.toFixed(2);
}

async function signup(){

const email=document.getElementById("email").value;
const password=document.getElementById("password").value;

const fb = window.firebaseSDK;

try{
await fb.createUserWithEmailAndPassword(auth,email,password);
}catch(err){
alert(err.message);
}
}

async function login(){

const email=document.getElementById("email").value;
const password=document.getElementById("password").value;

const fb = window.firebaseSDK;

try{
await fb.signInWithEmailAndPassword(auth,email,password);
}catch(err){
alert(err.message);
}
}

async function logout(){

const fb = window.firebaseSDK;

await fb.signOut(auth);
}

function showApp(){
document.getElementById("auth-screen").classList.add("hidden");
document.getElementById("app-screen").classList.remove("hidden");
}

function showAuth(){
document.getElementById("app-screen").classList.add("hidden");
document.getElementById("auth-screen").classList.remove("hidden");
}

function loadData(){
loadLocal();
render();
syncCloud();
}

function startApp(){

if(window.__started__) return;

window.__started__=true;

initFirebase();
}

if(document.readyState==="loading"){
document.addEventListener("DOMContentLoaded",startApp);
}else{
startApp();
}
