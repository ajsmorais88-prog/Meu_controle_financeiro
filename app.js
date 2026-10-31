(async () => {
  'use strict';
  const baseKeys = {
    TX_KEY: 'meu-controle-financeiro-transactions-v1',
    INCOME_KEY: 'meu-controle-financeiro-monthly-income-v1',
    ALLOCATION_KEY: 'meu-controle-financeiro-allocation-percentages-v1',
    CARD_KEY: 'meu-controle-financeiro-cards-v1',
    FIXED_KEY: 'meu-controle-financeiro-fixed-costs-v1',
    INVESTMENT_KEY: 'meu-controle-financeiro-investments-v1',
    BINANCE_BALANCES_KEY: 'meu-controle-financeiro-binance-balances-v1',
    BANK_BALANCE_KEY: 'meu-controle-financeiro-bank-balance-overrides-v1',
    BANK_ACCOUNTS_KEY: 'meu-controle-financeiro-bank-accounts-v1',
    BANK_SELECTED_ACCOUNT_KEY: 'meu-controle-financeiro-bank-selected-account-v1',
    BANK_EXCLUDED_ACCOUNTS_KEY: 'meu-controle-financeiro-bank-excluded-v1',
    NOTIFICATIONS_KEY: 'meu-controle-financeiro-notifications-v1'
  };
  const allowedStorageKeys = new Set(Object.values(baseKeys));
  let sessionInfo;
  let accountData = {};
  try {
    const sessionResponse = await fetch('/api/session', { cache: 'no-store' });
    sessionInfo = await sessionResponse.json();
    if (!sessionInfo.authenticated || !sessionInfo.userId) { location.href = '/login'; return; }
    const adminAccess = document.getElementById('adminAccess');
    if (adminAccess) adminAccess.hidden = !sessionInfo.isAdmin;
    let dataResponse = await fetch('/api/data', { cache: 'no-store' });
    let dataPayload = await dataResponse.json();
    if (!dataResponse.ok) throw new Error(dataPayload.error || 'Não foi possível carregar os dados da conta.');
    if (dataPayload.legacyImportAllowed) {
      const legacyData = {};
      for (const key of allowedStorageKeys) {
        const value = localStorage.getItem(key);
        if (value !== null) legacyData[key] = value;
      }
      const imported = await fetch('/api/data/import-legacy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: legacyData }), cache: 'no-store' });
      if (!imported.ok) throw new Error('Não foi possível importar os dados antigos para esta conta.');
      dataResponse = await fetch('/api/data', { cache: 'no-store' });
      dataPayload = await dataResponse.json();
      if (!dataResponse.ok) throw new Error(dataPayload.error || 'Não foi possível carregar os dados importados.');
    }
    accountData = dataPayload.data || {};
  } catch (error) {
    document.body.innerHTML = `<main style="max-width:620px;margin:12vh auto;padding:24px;font:16px Arial;color:#19372d"><h1>Não foi possível carregar sua conta</h1><p>${String(error.message || error).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}</p><button onclick="location.reload()">Tentar novamente</button></main>`;
    return;
  }
  const storagePrefix = `minhas-financas:${sessionInfo.userId}:`;
  const scopedKey = key => `${storagePrefix}${key}`;
  const nativeSetItem = Storage.prototype.setItem;
  const nativeRemoveItem = Storage.prototype.removeItem;
  const pendingWrites = new Map();
  function queueStorageWrite(key, method, value) {
    const previous = pendingWrites.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(() => fetch(`/api/data/${encodeURIComponent(key)}`, {
      method, headers: { 'Content-Type': 'application/json' },
      ...(method === 'PUT' ? { body: JSON.stringify({ value }) } : {}), cache: 'no-store'
    })).then(response => { if (!response.ok) throw new Error('A gravação no servidor falhou.'); }).catch(() => { console.warn('Não foi possível sincronizar os dados desta conta com o servidor.'); });
    pendingWrites.set(key, next);
  }
  for (const [name, key] of Object.entries(baseKeys)) {
    const remoteValue = accountData[key];
    const scoped = scopedKey(key);
    if (typeof remoteValue === 'string') nativeSetItem.call(localStorage, scoped, remoteValue);
    else if (localStorage.getItem(scoped) !== null) queueStorageWrite(key, 'PUT', localStorage.getItem(scoped));
  }
  Storage.prototype.setItem = function(key, value) {
    nativeSetItem.call(this, key, value);
    if (this === localStorage && String(key).startsWith(storagePrefix)) {
      const dataKey = String(key).slice(storagePrefix.length);
      if (allowedStorageKeys.has(dataKey)) queueStorageWrite(dataKey, 'PUT', String(value));
    }
  };
  Storage.prototype.removeItem = function(key) {
    nativeRemoveItem.call(this, key);
    if (this === localStorage && String(key).startsWith(storagePrefix)) {
      const dataKey = String(key).slice(storagePrefix.length);
      if (allowedStorageKeys.has(dataKey)) queueStorageWrite(dataKey, 'DELETE');
    }
  };
  const TX_KEY = scopedKey(baseKeys.TX_KEY);
  const INCOME_KEY = scopedKey(baseKeys.INCOME_KEY);
  const ALLOCATION_KEY = scopedKey(baseKeys.ALLOCATION_KEY);
  const CARD_KEY = scopedKey(baseKeys.CARD_KEY);
  const FIXED_KEY = scopedKey(baseKeys.FIXED_KEY);
  const INVESTMENT_KEY = scopedKey(baseKeys.INVESTMENT_KEY);
  const BINANCE_BALANCES_KEY = scopedKey(baseKeys.BINANCE_BALANCES_KEY);
  const BANK_BALANCE_KEY = scopedKey(baseKeys.BANK_BALANCE_KEY);
  const BANK_ACCOUNTS_KEY = scopedKey(baseKeys.BANK_ACCOUNTS_KEY);
  const BANK_SELECTED_ACCOUNT_KEY = scopedKey(baseKeys.BANK_SELECTED_ACCOUNT_KEY);
  const NOTIFICATIONS_KEY = scopedKey(baseKeys.NOTIFICATIONS_KEY);
  const $ = (selector) => document.querySelector(selector);
  let appNotifications=[];try{const saved=JSON.parse(localStorage.getItem(NOTIFICATIONS_KEY)||'[]');if(Array.isArray(saved))appNotifications=saved;}catch{}
  function renderNotifications(){const list=$('#notificationsList');if(!list)return;const unread=appNotifications.filter(item=>!item.read).length;const badge=$('#notificationsBadge'),button=$('#notificationsButton');badge.textContent=unread>99?'99+':String(unread);badge.hidden=unread===0;button.setAttribute('aria-label',unread?unread+' notificações não lidas':'Notificações');list.replaceChildren();if(!appNotifications.length){const empty=document.createElement('p');empty.className='notification-empty';empty.textContent='Nenhuma notificação por enquanto.';list.append(empty);return;}for(const item of appNotifications){const row=document.createElement('article');row.className='notification-row'+(item.read?'':' unread');const icon=document.createElement('span');icon.className='notification-row-icon '+(item.kind==='card'?'card':'bank');icon.textContent=item.kind==='card'?'▣':'↗';const content=document.createElement('div');content.className='notification-row-content';const title=document.createElement('strong');title.textContent=item.title;const description=document.createElement('p');description.textContent=item.description;const meta=document.createElement('small');const date=item.date?new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(item.date+'T12:00:00')).replace('.',''):'Data não informada';meta.textContent=date+' · '+(item.source||'');const value=document.createElement('b');value.textContent=money(item.amount);const details=document.createElement('button');details.type='button';details.className='notification-open';details.textContent=item.kind==='card'?'Ver cartão':'Ver transações';details.addEventListener('click',()=>{item.read=true;localStorage.setItem(NOTIFICATIONS_KEY,JSON.stringify(appNotifications));renderNotifications();$('#notificationsPanel').hidden=true;$('#notificationsButton').setAttribute('aria-expanded','false');selectView(item.kind==='card'?'cards':'transactions');});content.append(title,description,meta,value,details);row.append(icon,content);list.append(row);}}
  function addInAppNotification(transaction,kind,source,eventId=transaction?.id){if(!transaction||!eventId)return;const id=kind+':'+String(eventId);if(appNotifications.some(item=>item.id===id))return;appNotifications.unshift({id,kind,title:kind==='card'?'Compra no cartão registrada':transaction.type==='income'?'Entrada bancária registrada':'Saída bancária registrada',description:String(transaction.description||'Movimentação').slice(0,100),amount:Number(transaction.amount)||0,date:String(transaction.date||''),source:String(source||''),createdAt:Date.now(),read:false});appNotifications=appNotifications.slice(0,60);localStorage.setItem(NOTIFICATIONS_KEY,JSON.stringify(appNotifications));renderNotifications();}
  $('#notificationsButton').addEventListener('click',()=>{const panel=$('#notificationsPanel'),open=panel.hidden;panel.hidden=!open;$('#notificationsButton').setAttribute('aria-expanded',String(open));if(open)renderNotifications();});
  $('#markAllNotificationsRead').addEventListener('click',()=>{appNotifications=appNotifications.map(item=>({...item,read:true}));localStorage.setItem(NOTIFICATIONS_KEY,JSON.stringify(appNotifications));renderNotifications();});
  $('#clearNotifications').addEventListener('click',()=>{appNotifications=[];localStorage.setItem(NOTIFICATIONS_KEY,'[]');renderNotifications();});
  document.addEventListener('click',event=>{if(!event.target.closest('.notification-center')&&!event.target.closest('#notificationsButton')){$('#notificationsPanel').hidden=true;$('#notificationsButton').setAttribute('aria-expanded','false');}});

  const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dateISO = (date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const parseDate = (s) => { const [y,m,d] = String(s).split('-').map(Number); return new Date(y,m-1,d); };
  const readTransactions = () => { try { const data = JSON.parse(localStorage.getItem(TX_KEY) || '[]'); return Array.isArray(data) ? data : []; } catch { return []; } };
  let transactions = readTransactions();
  let bankAccounts = (()=>{try{const value=JSON.parse(localStorage.getItem(BANK_ACCOUNTS_KEY)||'[]');return Array.isArray(value)?value.filter(item=>item&&item.id&&item.name):[];}catch{return[];}})();
  if(!bankAccounts.length)bankAccounts=[{id:'main',name:'Conta principal'}];
  let selectedBankAccountId=localStorage.getItem(BANK_SELECTED_ACCOUNT_KEY)||bankAccounts[0].id;
  if(!bankAccounts.some(item=>String(item.id)===String(selectedBankAccountId)))selectedBankAccountId=bankAccounts[0].id;
  let migratedBankTransactions=false;for(const transaction of transactions){if(!transaction.statementBatchId&&!transaction.cardId&&transaction.paymentMethod!=='cartao'&&!transaction.bankAccountId){transaction.bankAccountId=bankAccounts[0].id;migratedBankTransactions=true;}}if(migratedBankTransactions)localStorage.setItem(TX_KEY,JSON.stringify(transactions));
  localStorage.setItem(BANK_ACCOUNTS_KEY,JSON.stringify(bankAccounts));localStorage.setItem(BANK_SELECTED_ACCOUNT_KEY,selectedBankAccountId);
  let cards = (() => { try { const data=JSON.parse(localStorage.getItem(CARD_KEY)||'[]'); return Array.isArray(data)?data:[]; } catch { return []; } })();
  let fixedCosts = (() => { try { const data=JSON.parse(localStorage.getItem(FIXED_KEY)||'[]'); return Array.isArray(data)?data:[]; } catch { return []; } })();
  let investments = (() => { try { const data=JSON.parse(localStorage.getItem(INVESTMENT_KEY)||'[]'); return Array.isArray(data)?data:[]; } catch { return []; } })();
  let syncedBinance = (() => { try { const data=JSON.parse(localStorage.getItem(BINANCE_BALANCES_KEY)||'null'); return data&&Array.isArray(data.balances)?data:null; } catch { return null; } })();
  let bankBalanceOverrides = (() => { try { const data=JSON.parse(localStorage.getItem(BANK_BALANCE_KEY)||'{}'); return data&&typeof data==='object'&&!Array.isArray(data)?data:{}; } catch { return {}; } })();
  let monthlyIncome = Number(localStorage.getItem(INCOME_KEY) || 0);
  let allocation = (() => { try { const value=JSON.parse(localStorage.getItem(ALLOCATION_KEY)||'null'); return value&&typeof value==='object'?{fixed:Number(value.fixed??50),card:Number(value.card??40),investment:Number(value.investment??10)}:{fixed:50,card:40,investment:10}; } catch { return {fixed:50,card:40,investment:10}; } })();
  let budget = monthlyIncome * allocation.card / 100 / 4;
  let weekOffset = 0;
  let monthOffset = 0;
  let editingId = null;
  let editingCardId = null;
  let editingFixedId = null;
  let editingFixedPaidContext = null;
  let payingFixedCostContext = null;
  let editingInvestmentId = null;
  const cryptoQuoteCache = new Map();
  const cryptoQuoteRequests = new Map();
  let investmentAllocationGeneration = 0;
  let cryptoPortfolioInvestedTotal = 0;
  let toastTimer;
  const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
  const cardClosingDay = (card) => { const day=Number(card?.closingDay); return Number.isInteger(day)&&day>=1&&day<=31?day:20; };
  const cardInvoiceMonth = (dateValue,card) => { const [year,month,day]=String(dateValue).slice(0,10).split('-').map(Number); return monthKey(new Date(year,month-1+(day>cardClosingDay(card)?1:0),1)); };
  function cardInstallmentAmount(transaction,index){const cents=Math.round((Number(transaction.amount)||0)*100);if(transaction.statementBatchId)return cents/100;const count=Math.min(120,Math.max(1,Number(transaction.installments)||1));const base=Math.floor(cents/count),extra=cents%count;return(base+(index<=extra?1:0))/100;}
  function isCardInvoicePayment(transaction){
    if(!transaction)return false;
    const normalize=value=>String(value||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLocaleUpperCase('pt-BR');
    const operationType=normalize(transaction.operationType);
    if(operationType.includes('PAGAMENTO')||operationType.includes('PAYMENT'))return true;
    const text=normalize([transaction.description,transaction.descriptionRaw,transaction.category].filter(Boolean).join(' '));
    return ['PAGAMENTO RECEBIDO','PAYMENT RECEIVED','CREDIT CARD PAYMENT','PAGAMENTO DE FATURA','PAGAMENTO DA FATURA','PAGAMENTO FATURA','PAGAMENTO DO CARTAO','PAGAMENTO CARTAO','PAGTO FATURA','PGTO FATURA'].some(phrase=>text.includes(phrase));
  }
  function cardPaymentSchedule(transaction,card){
    const count=Math.min(120,Math.max(1,Number(transaction.installments)||1));
    const current=Math.min(count,Math.max(1,Number(transaction.currentInstallment)||1));
    const sign=transaction.type==='income'?-1:1;
    let statementMonth=transaction.statementMonth;
    if(transaction.source==='MeuPluggy'){
      const matchedBill=transaction.billId&&Array.isArray(card?.pluggyBills)?card.pluggyBills.find(item=>String(item.id)===String(transaction.billId)):null;
      const isInstallment=Number(transaction.importedInstallmentCount)>1;
      statementMonth=isInstallment?(matchedBill?.monthKey||statementMonth||''):'';
    }else if(!transaction.statementBatchId){
      statementMonth='';
    }
    if(statementMonth&&(transaction.paymentMethod==='cartao'||transaction.cardId)){
      const [year,month]=String(statementMonth).split('-').map(Number);
      const schedule=[{transaction,installmentIndex:current,installmentCount:count,monthKey:String(statementMonth),amount:cardInstallmentAmount(transaction,current)*sign}];
      if(transaction.type==='expense'){
        for(let installment=current+1;installment<=count;installment++){
          const dueMonth=new Date(year,month-1+(installment-current),1);
          schedule.push({transaction,installmentIndex:installment,installmentCount:count,monthKey:monthKey(dueMonth),amount:cardInstallmentAmount(transaction,installment)});
        }
      }
      return schedule;
    }
    const referenceDate=String(transaction.purchaseDate||transaction.date).slice(0,10);
    const [year,month,day]=referenceDate.split('-').map(Number);
    const firstMonth=new Date(year,month-1+(day>cardClosingDay(card)?1:0),1);
    return Array.from({length:count},(_,index)=>{
      const paymentMonth=new Date(firstMonth.getFullYear(),firstMonth.getMonth()+index,1);
      return{transaction,installmentIndex:index+1,installmentCount:count,monthKey:monthKey(paymentMonth),amount:cardInstallmentAmount(transaction,index+1)*sign};
    });
  }
  function fixedPaidForMonth(item,selectedMonth){const overrides=item.paidOverrides&&Object.prototype.hasOwnProperty.call(item.paidOverrides,selectedMonth)?Number(item.paidOverrides[selectedMonth]):null;if(Number.isFinite(overrides))return Math.max(0,overrides);return transactions.filter(t=>t.type==='expense'&&String(t.fixedCostId)===String(item.id)&&String(t.fixedCostMonthKey||t.date||'').slice(0,7)===selectedMonth).reduce((sum,t)=>sum+(Number(t.amount)||0),0);}
  const fixedMonthlyTotal = () => { const current=monthKey(today); return fixedCosts.filter(item=>!item.monthKey||item.monthKey===current).reduce((sum,item)=>sum+fixedPaidForMonth(item,current),0); };
  function updateAllocationGap(id,target,actual,kind){const node=document.getElementById(id);if(!monthlyIncome){node.textContent='Informe sua renda';node.classList.remove('over');return;}const difference=Math.abs(target-actual);if(difference<0.005){node.textContent=kind==='goal'?'Meta atingida':'No limite';node.classList.remove('over');return;}if(actual>target){node.textContent=`Passou ${money(difference)} ${kind==='goal'?'da meta':'do limite'}`;node.classList.add('over');return;}node.textContent=kind==='goal'?`Faltam ${money(difference)} para a meta`:`Restam ${money(difference)} do limite`;node.classList.remove('over');}  function showToast(message) { const toast=$('#toast'); toast.textContent=message; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>toast.classList.remove('show'),2600); }
  function startOfWeek(date) { const d=new Date(date); d.setDate(d.getDate()-((d.getDay()+6)%7)); d.setHours(0,0,0,0); return d; }
  function weekBounds() { const monday=startOfWeek(today); monday.setDate(monday.getDate()+weekOffset*7); const sunday=new Date(monday); sunday.setDate(sunday.getDate()+6); sunday.setHours(23,59,59,999); return {monday,sunday}; }
  function realizedExpenseInRange(from,to){return transactions.filter(t=>{const date=parseDate(t.date);return t.type==='expense'&&!t.fixedCostId&&date>=from&&date<=to;}).reduce((sum,t)=>{const installments=Math.min(120,Math.max(1,Number(t.installments)||1));const creditCard=t.paymentMethod==='cartao'||Boolean(t.cardId);if(installments>1&&!creditCard&&['crediario','financiamento'].includes(t.paymentMethod))return sum;const amount=Number(t.amount)||0;const realizedAmount=creditCard&&installments>1&&!t.statementBatchId?Math.ceil(Math.round(amount*100)/installments)/100:amount;return sum+realizedAmount;},0);}
  function updateAllocationProgress(id,actual,target){const bar=document.getElementById(id);if(!bar)return;const percent=target>0?Math.max(0,Number(actual||0)/target*100):0;bar.style.width=`${Math.min(percent,100)}%`;bar.parentElement.classList.toggle('over',percent>100);bar.parentElement.setAttribute('aria-valuenow',String(Math.round(percent)));}
  function scheduledCardTotal(period){return transactions.filter(t=>t.type==='expense'&&(t.paymentMethod==='cartao'||t.cardId)).reduce((sum,t)=>{const card=cards.find(item=>String(item.id)===String(t.cardId));return sum+cardPaymentSchedule(t,card).filter(payment=>payment.monthKey===period).reduce((monthSum,payment)=>monthSum+payment.amount,0);},0);}
  function render() {
    reconcileFixedCostsWithBankTransactions();
    const isMonth=true;
    const {monday,sunday}=weekBounds();
    const monthStart=new Date(today.getFullYear(),today.getMonth()+monthOffset,1);
    const monthSelect=$('#overviewMonthSelect'),selectedMonthKey=monthKey(monthStart),selectedYear=String(monthStart.getFullYear());
    if(monthSelect.dataset.year!==selectedYear){monthSelect.replaceChildren(...Array.from({length:12},(_,index)=>{const optionDate=new Date(monthStart.getFullYear(),index,1);return new Option(new Intl.DateTimeFormat('pt-BR',{month:'long'}).format(optionDate),monthKey(optionDate));}));monthSelect.dataset.year=selectedYear;}
    monthSelect.value=selectedMonthKey;$('#overviewYearLabel').textContent=selectedYear;
    const rangeStart=isMonth?monthStart:monday;
    const rangeEnd=isMonth?new Date(monthStart.getFullYear(),monthStart.getMonth()+1,0,23,59,59,999):sunday;
    const fmt=(d)=>new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short'}).format(d).replace('.','');
    const monthLabel=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(monthStart);
    $('#todayLabel').textContent=isMonth?(monthOffset===0?'Este mês':monthOffset===-1?'Mês passado':monthOffset===1?'Próximo mês':monthLabel):(weekOffset===0?'Esta semana':weekOffset===-1?'Semana passada':weekOffset===1?'Próxima semana':'Semana');
    $('#weekRange').textContent=isMonth?monthLabel.charAt(0).toLocaleUpperCase('pt-BR')+monthLabel.slice(1):`${fmt(monday)} – ${fmt(sunday)}`;
    $('#prevWeek').setAttribute('aria-label',isMonth?'Mês anterior':'Semana anterior');
    $('#nextWeek').setAttribute('aria-label',isMonth?'Próximo mês':'Próxima semana');
    const inWeek=transactions.filter(t=>{const d=parseDate(t.date);return d>=rangeStart&&d<=rangeEnd;});
    const primaryBankAccount=bankAccounts[0]||{id:'main',name:'Conta principal'};const primaryAccountTransactions=inWeek.filter(t=>!t.statementBatchId&&t.paymentMethod!=='cartao'&&!t.cardId&&transactionBankAccountId(t)===String(primaryBankAccount.id));
    const income=primaryAccountTransactions.filter(t=>t.type==='income').reduce((s,t)=>s+Number(t.amount||0),0);
    const expense=primaryAccountTransactions.filter(t=>t.type==='expense').reduce((sum,t)=>sum+Number(t.amount||0),0);
    $('#balanceValue').textContent=money(income-expense); $('#incomeValue').textContent=money(income); $('#expenseValue').textContent=money(expense);
    $('#overviewBalanceCaption').textContent=`${primaryBankAccount.name} · Entradas menos saídas`;$('#overviewIncomeCaption').textContent=`${primaryBankAccount.name} · Dinheiro que entrou`;$('#overviewExpenseCaption').textContent=`${primaryBankAccount.name} · Dinheiro que saiu`;
    $('#fixedShare').textContent=money(monthlyIncome*allocation.fixed/100); $('#fixedCurrentValue').textContent=money(fixedMonthlyTotal()); $('#cardShare').textContent=money(monthlyIncome*allocation.card/100); $('#investmentShare').textContent=money(monthlyIncome*allocation.investment/100);
    document.querySelectorAll('.allocation-percent').forEach((node,index)=>node.textContent=`${[allocation.fixed,allocation.card,allocation.investment][index]}%`);
    $('#fixedAllowanceLabel').textContent=`Limite mensal · ${allocation.fixed}% da renda`;$('#investmentTargetLabel').textContent=`Meta mensal · ${allocation.investment}% da renda`;
    $('#allocationPlanLabel').textContent='PLANEJAMENTO · MONITORAMENTO AUTOMÁTICO';
    $('#allocationSettingsCurrent').textContent=`Custos Fixos ${allocation.fixed}% · Gastos com Cartão ${allocation.card}% · Investimento ${allocation.investment}%`;
    const currentMonth=monthKey(today);
    const planningMonth=isMonth?monthKey(monthStart):currentMonth;
    const planningMonthDate=new Date(Number(planningMonth.slice(0,4)),Number(planningMonth.slice(5,7))-1,1);
    const nextMonth=monthKey(new Date(planningMonthDate.getFullYear(),planningMonthDate.getMonth()+1,1));
    const currentCardInvoice=transactions.filter(t=>{if(t.paymentMethod!=='cartao'&&!t.cardId)return false;if(t.statementBatchId)return String(t.statementMonth||'')===currentMonth;return t.type==='expense'&&monthKey(parseDate(t.date))===currentMonth;}).reduce((sum,t)=>{const amount=Number(t.amount)||0;if(t.statementBatchId)return sum+(t.type==='income'?-1:1)*amount;if(t.type!=='expense')return sum;const installments=Math.min(120,Math.max(1,Number(t.installments)||1));const monthlyPurchaseAmount=installments>1?Math.ceil(Math.round(amount*100)/installments)/100:amount;return sum+monthlyPurchaseAmount;},0),nextMonthCardExpenses=scheduledCardTotal(nextMonth);
    $('#cardShare').textContent=money(Math.max(0,monthlyIncome*allocation.card/100-nextMonthCardExpenses));
    $('#cardBudgetBreakdown').textContent=`${money(monthlyIncome*allocation.card/100)} − ${money(nextMonthCardExpenses)} de despesas futuras = ${money(Math.max(0,monthlyIncome*allocation.card/100-nextMonthCardExpenses))} previstos para o mês`;
    budget=Math.max(0,(monthlyIncome*allocation.card/100-nextMonthCardExpenses)/4);
    const periodBudget=isMonth?budget*4:budget;
    const realizedExpense=realizedExpenseInRange(rangeStart,rangeEnd)+(isMonth?nextMonthCardExpenses:nextMonthCardExpenses/4);
    $('#plannedValue').textContent=money(periodBudget); $('#spentValue').textContent=money(realizedExpense);
    const currentMonthInvestmentContributions=investments.filter(item=>String(item.date||'').slice(0,7)===currentMonth&&(item.movement||'contribution')==='contribution').reduce((sum,item)=>sum+Number(item.amount||0),0);
    const currentMonthInvestmentWithdrawals=investments.filter(item=>String(item.date||'').slice(0,7)===currentMonth&&item.movement==='withdrawal').reduce((sum,item)=>sum+Number(item.amount||0),0);
    const currentMonthInvestmentBalance=currentMonthInvestmentContributions-currentMonthInvestmentWithdrawals;
    renderFinancialAlerts(currentCardInvoice,currentMonthInvestmentBalance,Math.max(0,monthlyIncome*allocation.card/100-nextMonthCardExpenses));
    $('#currentCardInvoice').textContent=money(currentCardInvoice); $('#currentMonthInvestment').textContent=money(currentMonthInvestmentBalance); $('#currentMonthInvestmentContributions').textContent=`Aportado: ${money(currentMonthInvestmentContributions)}`; $('#currentMonthInvestmentWithdrawals').textContent=`Resgatado: ${money(currentMonthInvestmentWithdrawals)}`;    updateAllocationGap('fixedGap',monthlyIncome*allocation.fixed/100,fixedMonthlyTotal(),'limit');
    updateAllocationGap('cardGap',monthlyIncome*allocation.card/100,currentCardInvoice+nextMonthCardExpenses,'limit');
    updateAllocationGap('investmentGap',monthlyIncome*allocation.investment/100,currentMonthInvestmentBalance,'goal');
    updateAllocationProgress('fixedAllocationProgress',fixedMonthlyTotal(),monthlyIncome*allocation.fixed/100);updateAllocationProgress('cardAllocationProgress',currentCardInvoice+nextMonthCardExpenses,monthlyIncome*allocation.card/100);updateAllocationProgress('investmentAllocationProgress',currentMonthInvestmentBalance,monthlyIncome*allocation.investment/100);    const percent=periodBudget>0?Math.round(realizedExpense/periodBudget*100):0; const shown=Math.min(percent,100);
    $('#progressFill').style.width=`${shown}%`; $('#progressFill').classList.toggle('over',periodBudget>0&&realizedExpense>periodBudget);
    $('.progress-track').setAttribute('aria-valuenow',String(shown)); $('#progressPercent').textContent=`${percent}%`; $('#progressPercent').classList.toggle('over',periodBudget>0&&realizedExpense>periodBudget);
    $('#remainingLabel').textContent=monthlyIncome<=0?'Defina sua renda mensal':realizedExpense>periodBudget?`Você passou ${money(realizedExpense-periodBudget)} do limite`: `Restam ${money(periodBudget-realizedExpense)} no limite`;
    $('#transactionsMonthFilter').value=monthKey(monthStart);
    renderAllTransactions();
    $('#balanceValue').textContent=$('#bankAccountBalance').textContent;
    const overviewAccount=bankAccounts.find(account=>String(account.id)===String(selectedBankAccountId));
    $('#overviewIncomeCaption').textContent=`${overviewAccount?.name||'Conta principal'} · Total recebido no mês`;
    $('#overviewExpenseCaption').textContent=`${overviewAccount?.name||'Conta principal'} · Total pago ou registrado no mês`;
    $('#overviewBalanceCaption').textContent=`${overviewAccount?.name||'Conta principal'} · Saldo atualizado do mês`;
    renderCards();
    renderFixedCosts();
    renderFixedAnnualChart();
    renderCardPurchases();
    renderCardProjection();
    renderCardInvoiceChart();
    renderDashboardChartSafely(renderMonthlyWeeklyChart,'monthlyWeeklyChart','monthlyWeeklyEmpty','análise semanal');
    renderDashboardChartSafely(renderMonthlyAllocationChart,'monthlyAllocationChart','monthlyAllocationEmpty','detalhamento mensal');
    renderInvestments();
    renderCryptoPortfolio();
    renderInvestmentAllocation();
    renderScheduledFixedCosts();
  }
  function sumBankTransactions(bankTransactions,from,to){return bankTransactions.filter(t=>{const date=parseDate(t.date);return (!from||date>=from)&&(!to||date<to);}).reduce((balance,t)=>balance+(t.type==='income'?1:-1)*Math.abs(Number(t.amount)||0),0);}
  function bankBalanceKey(accountId,month){return `${accountId}::${month}`;}
  function bankBalanceOverride(accountId,month){const key=bankBalanceKey(accountId,month);if(Object.prototype.hasOwnProperty.call(bankBalanceOverrides,key))return Number(bankBalanceOverrides[key])||0;if(String(accountId)===String(bankAccounts[0]?.id)&&Object.prototype.hasOwnProperty.call(bankBalanceOverrides,month))return Number(bankBalanceOverrides[month])||0;return null;}
  function transactionBankAccountId(transaction){return String(transaction.bankAccountId||bankAccounts[0]?.id||'main');}
  function bankAccountOptionLabel(account){const bank=String(account.bankName||account.name||'Conta bancária').replace(/\s*·\s*MeuPluggy$/,'').trim();const type=String(account.accountType||'').toUpperCase();const typeLabel=type==='CHECKING_ACCOUNT'?'Conta corrente':type==='SAVINGS_ACCOUNT'?'Poupança':type?type.replaceAll('_',' ').toLocaleLowerCase('pt-BR'):'';const number=String(account.accountNumber||'').replace(/\D/g,'');const suffix=number?` · final ${number.slice(-4)}`:'';return `${bank}${typeLabel?` · ${typeLabel}`:''}${suffix}`;}
  function renderBankAccountOptions(){const select=$('#bankAccountSelect');if(!select)return;const activeAccounts=bankAccounts.filter(account=>!account.excluded);select.replaceChildren(...(activeAccounts.length?activeAccounts.map(account=>new Option(bankAccountOptionLabel(account),String(account.id))):[new Option('Nenhuma conta cadastrada','')]));select.value=activeAccounts.some(account=>String(account.id)===String(selectedBankAccountId))?String(selectedBankAccountId):'';const remove=$('#deleteBankAccount');if(remove)remove.disabled=!activeAccounts.some(account=>String(account.id)===String(selectedBankAccountId));}
  let overviewBankAccountId=String(bankAccounts[0]?.id||'');
  function renderOverviewBankSummary(){
    const select=$('#overviewBankSelect');if(!select)return;
    const activeAccounts=bankAccounts.filter(account=>!account.excluded&&String(account.id)!=='main'&&String(account.bankName||account.name||'').trim().toLocaleLowerCase('pt-BR')!=='conta principal');
    if(!activeAccounts.some(account=>String(account.id)===overviewBankAccountId))overviewBankAccountId=String(activeAccounts[0]?.id||'');
    select.replaceChildren(...(activeAccounts.length?activeAccounts.map(account=>new Option(bankAccountOptionLabel(account),String(account.id))):[new Option('Nenhuma conta cadastrada','')]));
    select.value=overviewBankAccountId;select.disabled=!activeAccounts.length;
    const account=activeAccounts.find(item=>String(item.id)===overviewBankAccountId);
    if(!account){$('#overviewOpeningBalance').textContent=money(0);$('#incomeValue').textContent=money(0);$('#expenseValue').textContent=money(0);$('#balanceValue').textContent=money(0);$('#overviewOpeningCaption').textContent='Nenhuma conta cadastrada';$('#overviewIncomeCaption').textContent='Nenhuma conta cadastrada';$('#overviewExpenseCaption').textContent='Nenhuma conta cadastrada';$('#overviewBalanceCaption').textContent='Cadastre ou sincronize uma conta bancária';return;}
    const selectedMonth=monthKey(new Date(today.getFullYear(),today.getMonth()+monthOffset,1));
    const accountTransactions=transactions.filter(t=>!t.statementBatchId&&t.paymentMethod!=='cartao'&&!t.cardId&&transactionBankAccountId(t)===overviewBankAccountId);
    const monthTransactions=accountTransactions.filter(t=>String(t.date||'').slice(0,7)===selectedMonth);
    const income=monthTransactions.filter(t=>t.type==='income').reduce((sum,t)=>sum+Math.abs(Number(t.amount)||0),0);
    const expense=monthTransactions.filter(t=>t.type==='expense').reduce((sum,t)=>sum+Math.abs(Number(t.amount)||0),0);
    const [year,month]=selectedMonth.split('-').map(Number),monthDate=new Date(year,month-1,1);
    const previousMonthKey=monthKey(new Date(year,month-2,1));
    const previousMonthTransactions=accountTransactions.filter(t=>String(t.date||'').slice(0,7)===previousMonthKey);
    const previousIncome=previousMonthTransactions.filter(t=>t.type==='income').reduce((sum,t)=>sum+Math.abs(Number(t.amount)||0),0);
    const previousExpense=previousMonthTransactions.filter(t=>t.type==='expense').reduce((sum,t)=>sum+Math.abs(Number(t.amount)||0),0);
    const openingBalance=bankAccountBalanceForMonth(account,previousMonthKey,accountTransactions,previousIncome,previousExpense);
    const balance=bankAccountBalanceForMonth(account,selectedMonth,accountTransactions,income,expense);
    const expectedBalance=openingBalance+income-expense;
    const reconciliationDifference=balance-expectedBalance;
    $('#overviewOpeningBalance').textContent=money(openingBalance);
    $('#incomeValue').textContent=money(income);$('#expenseValue').textContent=money(expense);$('#balanceValue').textContent=money(balance);
    const monthLabel=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(monthDate);
    const previousMonthLabel=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(new Date(year,month-2,1));
    const currentMonthKey=monthKey(today);
    const balanceTitle=selectedMonth===currentMonthKey?'Saldo atual':selectedMonth<currentMonthKey?'Saldo ao fim do mês':'Saldo projetado';
    $('#overviewOpeningCaption').textContent=`Fechamento de ${previousMonthLabel}`;
    $('#overviewIncomeCaption').textContent=`Total recebido · ${monthLabel}`;
    $('#overviewExpenseCaption').textContent=`Total pago ou registrado · ${monthLabel}`;
    $('#overviewBalanceTitle').textContent=balanceTitle;
    $('#overviewBalanceCaption').textContent=Math.abs(reconciliationDifference)<0.01?'Saldo inicial + entradas − saídas':`Diferença de conciliação: ${money(Math.abs(reconciliationDifference))} ${reconciliationDifference>0?'acima':'abaixo'} do saldo calculado`;
  }
  function getBankClosingBalance(targetMonth,bankTransactions,accountId=selectedBankAccountId){const known=bankBalanceOverride(accountId,targetMonth);if(known!==null)return known;const prefix=`${accountId}::`;const overrides=Object.entries(bankBalanceOverrides).map(([key,value])=>key.startsWith(prefix)?[key.slice(prefix.length),value]:String(accountId)===String(bankAccounts[0]?.id)&&/^\d{4}-\d{2}$/.test(key)?[key,value]:null).filter(entry=>entry&&entry[0]<=targetMonth).sort((a,b)=>a[0].localeCompare(b[0]));const [year,month]=targetMonth.split('-').map(Number),cutoff=new Date(year,month,1);if(!overrides.length)return sumBankTransactions(bankTransactions,null,cutoff);const [baseMonth,baseValue]=overrides[overrides.length-1],[baseYear,baseMonthNumber]=baseMonth.split('-').map(Number);return(Number(baseValue)||0)+sumBankTransactions(bankTransactions,new Date(baseYear,baseMonthNumber,1),cutoff);}
  function bankAccountBalanceForMonth(account,targetMonth,accountTransactions,income,expense){
    const pluggyBalance=account?.source==='MeuPluggy'&&Number.isFinite(Number(account.balance))?Number(account.balance):null;
    if(pluggyBalance!==null){
      const [year,month]=targetMonth.split('-').map(Number),periodStart=new Date(year,month-1,1),periodEnd=new Date(year,month,1);
      const rawSnapshot=account.balanceUpdatedAt||account.updatedAt||today;const parsedSnapshot=new Date(rawSnapshot);
      const snapshot=Number.isNaN(parsedSnapshot.getTime())?new Date(today):parsedSnapshot;snapshot.setHours(0,0,0,0);
      const afterSnapshot=new Date(snapshot);afterSnapshot.setDate(afterSnapshot.getDate()+1);
      const snapshotMonth=new Date(snapshot.getFullYear(),snapshot.getMonth(),1);
      return periodStart>=snapshotMonth?pluggyBalance+sumBankTransactions(accountTransactions,afterSnapshot,periodEnd):pluggyBalance-sumBankTransactions(accountTransactions,periodEnd,afterSnapshot);
    }
    const override=bankBalanceOverride(account?.id,targetMonth);if(override!==null)return override;
    const [year,month]=targetMonth.split('-').map(Number),previousMonth=monthKey(new Date(year,month-2,1));
    const previousBalance=getBankClosingBalance(previousMonth,accountTransactions,account?.id);
    return previousBalance+(Number(income)||0)-(Number(expense)||0);
  }
  function renderAllTransactions(){
    const selectedMonth=$('#transactionsMonthFilter').value||monthKey(today);
    renderBankAccountOptions();const accountTransactions=transactions.filter(t=>!t.statementBatchId&&t.paymentMethod!=='cartao'&&!t.cardId&&transactionBankAccountId(t)===String(selectedBankAccountId));
    const monthTransactions=accountTransactions.filter(t=>String(t.date||'').slice(0,7)===selectedMonth).sort((a,b)=>String(b.date).localeCompare(String(a.date))||Number(b.createdAt||0)-Number(a.createdAt||0));
    const income=monthTransactions.filter(t=>t.type==='income').reduce((sum,t)=>sum+Math.abs(Number(t.amount)||0),0);
    const expense=monthTransactions.filter(t=>t.type==='expense').reduce((sum,t)=>sum+Math.abs(Number(t.amount)||0),0);
    const monthDate=new Date(Number(selectedMonth.slice(0,4)),Number(selectedMonth.slice(5,7))-1,1);
    const bankTransactions=accountTransactions;
    updateOpeningBalanceFromStatement(bankTransactions);
    const selectedBankAccount=bankAccounts.find(account=>String(account.id)===String(selectedBankAccountId));
    const previousMonthKey=monthKey(new Date(monthDate.getFullYear(),monthDate.getMonth()-1,1));
    const previousMonthTransactions=bankTransactions.filter(t=>String(t.date||'').slice(0,7)===previousMonthKey);
    const previousIncome=previousMonthTransactions.filter(t=>t.type==='income').reduce((sum,t)=>sum+Math.abs(Number(t.amount)||0),0);
    const previousExpense=previousMonthTransactions.filter(t=>t.type==='expense').reduce((sum,t)=>sum+Math.abs(Number(t.amount)||0),0);
    const openingBalance=bankAccountBalanceForMonth(selectedBankAccount,previousMonthKey,bankTransactions,previousIncome,previousExpense);
    const selectedAccountBalance=bankAccountBalanceForMonth(selectedBankAccount,selectedMonth,bankTransactions,income,expense);
    const expectedBalance=openingBalance+income-expense;
    const reconciliationDifference=selectedAccountBalance-expectedBalance;
    const monthLabel=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(monthDate);
    const previousMonthLabel=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(new Date(monthDate.getFullYear(),monthDate.getMonth()-1,1));
    $('#bankOpeningBalance').textContent=money(openingBalance);
    $('#bankOpeningBalanceCaption').textContent=`Fechamento de ${previousMonthLabel}`;
    $('#bankAccountBalance').textContent=money(selectedAccountBalance);
    const currentMonthKey=monthKey(today);
    $('#bankBalanceTitle').textContent=selectedMonth===currentMonthKey?'Saldo atual':selectedMonth<currentMonthKey?'Saldo ao fim do mês':'Saldo projetado';
    $('#bankCurrentBalanceCaption').textContent=Math.abs(reconciliationDifference)<0.01?'Saldo inicial + entradas − saídas':`Diferença de conciliação: ${money(Math.abs(reconciliationDifference))} ${reconciliationDifference>0?'acima':'abaixo'} do saldo calculado`;
    $('#allTransactionsMonthLabel').textContent=`${selectedBankAccount?.name||'Conta'} · ${monthLabel}`;
    $('#allTransactionsIncome').textContent=money(income);
    $('#allTransactionsExpense').textContent=money(expense);
    const list=$('#allTransactionsList');list.replaceChildren();$('#allTransactionsEmpty').hidden=monthTransactions.length>0;
    const methods={dinheiro:'Dinheiro',pix:'Pix',cartao:'Cartão de crédito',crediario:'Crediário',financiamento:'Financiamento',bradesco:'Bradesco'};
    for(const transaction of monthTransactions){
      const row=document.createElement('div');row.className='transaction-row';
      const icon=document.createElement('span');icon.className=`transaction-icon ${transaction.type}`;icon.textContent=transaction.type==='income'?'↓':'↗';
      const details=document.createElement('div');details.className='all-transaction-details';
      const name=document.createElement('div');name.className='transaction-name';name.textContent=transaction.description||'Transação';
      const cardName=cards.find(card=>String(card.id)===String(transaction.cardId))?.name;
      const method=cardName||methods[transaction.paymentMethod]||(transaction.cardId?'Cartão de crédito':'');
      const date=new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',year:'numeric'}).format(parseDate(transaction.date)).replace('.','');
      const parts=[transaction.category||'Sem categoria',date,method];
      if(Number(transaction.installments)>1)parts.push(`${transaction.installments} parcelas`);
      if(transaction.fixedCostId)parts.push('Custo fixo pago');
      const meta=document.createElement('div');meta.className='transaction-meta';meta.textContent=parts.filter(Boolean).join(' · ');details.append(name,meta);
      const amount=document.createElement('div');amount.className=`transaction-amount ${transaction.type}`;amount.textContent=`${transaction.type==='income'?'+':'−'} ${money(transaction.amount)}`;
      const actions=document.createElement('div');actions.className='transaction-actions';
      const edit=document.createElement('button');edit.type='button';edit.className='row-action';edit.textContent='Editar';edit.setAttribute('aria-label',`Editar ${transaction.description||'transação'}`);edit.addEventListener('click',()=>openEdit(transaction.id));
      const remove=document.createElement('button');remove.type='button';remove.className='row-action row-delete';remove.textContent='Apagar';remove.setAttribute('aria-label',`Apagar ${transaction.description||'transação'}`);remove.addEventListener('click',()=>deleteTransaction(transaction.id));
      actions.append(edit,remove);row.append(icon,details,amount,actions);list.append(row);
    }
    renderOverviewBankSummary();
  }
  function renderDashboardChartSafely(renderer,chartId,emptyId,label){
    try{renderer();}
    catch(error){console.error(`Falha ao renderizar ${label}.`,error);const chart=document.getElementById(chartId),empty=document.getElementById(emptyId);if(chart)chart.replaceChildren();if(empty){empty.hidden=false;empty.textContent='Não foi possível carregar este gráfico. Tente novamente em instantes.';}}
  }
  function renderMonthlyWeeklyChart(){
    const chart=$('#monthlyWeeklyChart');const empty=$('#monthlyWeeklyEmpty');chart.replaceChildren();empty.hidden=true;
    const selected=monthKey(new Date(today.getFullYear(),today.getMonth()+monthOffset,1));const [year,month]=selected.split('-').map(Number);
    const monthStart=new Date(year,month-1,1);$('#weeklyChartMonth').textContent=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(monthStart);const monthEnd=new Date(year,month,0);const nextMonth=monthKey(new Date(year,month,1));const weeklyBudget=Math.max(0,monthlyIncome*allocation.card/100-scheduledCardTotal(nextMonth))/4;const weeks=[];let cursor=startOfWeek(monthStart);
    while(cursor<=monthEnd){const weekEnd=new Date(cursor);weekEnd.setDate(weekEnd.getDate()+6);const from=new Date(Math.max(cursor.getTime(),monthStart.getTime()));const to=new Date(Math.min(weekEnd.getTime(),monthEnd.getTime()));const days=Math.round((to-from)/86400000)+1;to.setHours(23,59,59,999);weeks.push({from,to,days,realized:realizedExpenseInRange(from,to),planned:weeklyBudget*days/7});cursor=new Date(cursor);cursor.setDate(cursor.getDate()+7);}
    const maxValue=Math.max(0,...weeks.flatMap(week=>[week.planned,week.realized]));empty.hidden=maxValue>0;empty.textContent='Sem renda planejada ou despesas realizadas neste mês.';
    for(let index=0;index<weeks.length;index++){const week=weeks[index];const group=document.createElement('div');group.className='monthly-week-group';const range=document.createElement('strong');range.className='monthly-week-range';range.textContent=`${week.from.getDate()}–${week.to.getDate()}`;const bars=document.createElement('div');bars.className='monthly-week-bars';for(const value of [{label:'Planejado',amount:week.planned,type:'planned'},{label:'Realizado',amount:week.realized,type:'realized'}]){const item=document.createElement('div');item.className='monthly-week-bar-item';const amount=document.createElement('span');amount.className='monthly-week-amount';amount.textContent=money(value.amount);const track=document.createElement('div');track.className='monthly-week-track';const fill=document.createElement('div');fill.className=`monthly-week-fill ${value.type}`;fill.style.height=`${value.amount?Math.max(2,value.amount/maxValue*100):0}%`;track.append(fill);const label=document.createElement('small');label.textContent=value.label;item.append(amount,track,label);bars.append(item);}group.append(range,bars);group.setAttribute('aria-label',`Semana ${index+1}, ${week.from.getDate()} a ${week.to.getDate()} do mês: planejado ${money(week.planned)}, realizado ${money(week.realized)}`);chart.append(group);}
  }
  function renderMonthlyAllocationChart(){
    const chart=$('#monthlyAllocationChart');const empty=$('#monthlyAllocationEmpty');chart.replaceChildren();empty.hidden=true;
    const currentMonth=monthKey(new Date(today.getFullYear(),today.getMonth()+monthOffset,1));const [chartYear,chartMonth]=currentMonth.split('-').map(Number);const chartDate=new Date(chartYear,chartMonth-1,1);$('#allocationChartMonth').textContent=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(chartDate);
    const fixedRows=fixedCosts.filter(item=>!item.monthKey||item.monthKey===currentMonth).map(item=>{const paid=fixedPaidForMonth(item,currentMonth);return{name:item.name,meta:paid?`Pago · vence dia ${item.dueDay}`:`Pendente · vence dia ${item.dueDay}`,amount:paid||Number(item.amount)||0,state:paid?'paid':'pending'};}).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
    const cardRows=[];for(const transaction of transactions){if(transaction.type!=='expense'||(transaction.paymentMethod!=='cartao'&&!transaction.cardId)||monthKey(parseDate(transaction.date))!==currentMonth)continue;const card=cards.find(item=>String(item.id)===String(transaction.cardId));const count=Math.min(120,Math.max(1,Number(transaction.installments)||1));const total=Number(transaction.amount)||0;const installmentAmount=count>1?Math.ceil(Math.round(total*100)/count)/100:total;const meta=card?.name||(transaction.cardId?'Cartão não cadastrado':'Cartão sem identificação');cardRows.push({name:transaction.description,meta:count>1?`${meta} · Compra parcelada em ${count}x · parcela ${money(installmentAmount)}`:meta,amount:installmentAmount});}
    cardRows.sort((a,b)=>b.amount-a.amount);
    const investmentMap=new Map();for(const item of investments){if(String(item.date||'').slice(0,7)!==currentMonth)continue;const key=`${item.name} · ${item.kind}`,position=investmentMap.get(key)||{name:key,contributions:0,withdrawals:0};if((item.movement||'contribution')==='withdrawal')position.withdrawals+=Number(item.amount)||0;else position.contributions+=Number(item.amount)||0;investmentMap.set(key,position);}const investmentRows=[...investmentMap.values()].map(item=>{const balance=item.contributions-item.withdrawals;return{name:item.name,meta:`Aportado ${money(item.contributions)} · Resgatado ${money(item.withdrawals)} · Saldo ${money(balance)}`,amount:balance,state:balance<0?'investment-negative':'investment-positive'};}).sort((a,b)=>Math.abs(b.amount)-Math.abs(a.amount));
    const groups=[{title:'Custos fixos vigentes',description:'Compromissos cadastrados para este mês',rows:fixedRows,type:'fixed',empty:'Nenhum custo fixo vigente cadastrado.'},{title:'Compras no cartão de crédito',description:'Compras feitas neste mês: valor total à vista e uma parcela para compras parceladas',rows:cardRows,type:'card',empty:'Nenhuma compra de cartão registrada neste mês.'},{title:'Investimento vigente',description:'Aportes e resgates do mês; o total mostra o saldo líquido por investimento',rows:investmentRows,type:'investment',empty:'Nenhum aporte ou resgate registrado neste mês.'}];
    if(groups.every(group=>group.rows.length===0)){empty.hidden=false;empty.textContent='Não há custos, compras no cartão ou aportes e resgates registrados para este mês.';return;}
    for(const groupData of groups){const section=document.createElement('section');section.className=`allocation-breakdown allocation-breakdown-${groupData.type}`;const heading=document.createElement('div');heading.className='allocation-breakdown-heading';const title=document.createElement('h3');title.textContent=groupData.title;const total=document.createElement('strong');total.textContent=money(groupData.rows.reduce((sum,item)=>sum+item.amount,0));heading.append(title,total);const description=document.createElement('p');description.textContent=groupData.description;section.append(heading,description);if(!groupData.rows.length){const note=document.createElement('p');note.className='allocation-breakdown-empty';note.textContent=groupData.empty;section.append(note);}else{const list=document.createElement('div');list.className='allocation-breakdown-list';const max=Math.max(...groupData.rows.map(item=>Math.abs(item.amount)),0);for(const itemData of groupData.rows){const row=document.createElement('div');row.className='allocation-breakdown-row';const top=document.createElement('div');top.className='allocation-breakdown-row-top';const details=document.createElement('div');details.className='allocation-breakdown-details';const name=document.createElement('strong');name.textContent=itemData.name;const meta=document.createElement('small');meta.textContent=itemData.meta;details.append(name,meta);const amount=document.createElement('strong');amount.className=`allocation-breakdown-amount${itemData.amount<0?' negative':''}`;amount.textContent=money(itemData.amount);top.append(details,amount);const track=document.createElement('div');track.className='allocation-breakdown-track';const fill=document.createElement('div');fill.className=`allocation-breakdown-fill${itemData.state?` ${itemData.state}`:''}`;fill.style.width=`${itemData.amount&&max?Math.max(2,Math.abs(itemData.amount)/max*100):0}%`;track.append(fill);row.append(top,track);list.append(row);}section.append(list);}chart.append(section);}
  }
  function fixedCostOccurrenceMonth(item){return item.monthKey||monthKey(today);}
  function fixedCostDueDate(item){const month=fixedCostOccurrenceMonth(item);const [year,monthNumber]=month.split('-').map(Number);const lastDay=new Date(year,monthNumber,0).getDate();const day=Math.min(Math.max(1,Number(item.dueDay)||1),lastDay);return `${year}-${String(monthNumber).padStart(2,'0')}-${String(day).padStart(2,'0')}`;}
  function normalizeBankMatchText(value){return String(value||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
  function fixedCostBankDescriptionMatches(item,transaction){const description=normalizeBankMatchText([transaction.description,transaction.category].filter(Boolean).join(' '));const configured=String(item.bankMatchTerms||'').split(/[,;|]/).map(normalizeBankMatchText).filter(Boolean);if(configured.some(term=>description.includes(term)))return true;const name=normalizeBankMatchText(item.name);if(/energia|eletrica|conta de luz/.test(name)){const providers=['energia','energisa','equatorial','amazonas energia','enel','celesc','cpfl','neoenergia','light','edp','conta de luz'];if(providers.some(term=>description.includes(term)))return true;}if(/financiamento/.test(name)&&/apart|imovel|habitacional|habitacao|casa/.test(name)){return /financ/.test(description)&&/(habit|imobili|apart|moradia|credito imob)/.test(description);}return false;}

  function reconcileFixedCostsWithBankTransactions(){const claimed=new Set(transactions.filter(t=>t.fixedCostId).map(t=>String(t.id)));let changed=false;for(const item of [...fixedCosts].sort((a,b)=>fixedCostDueDate(a).localeCompare(fixedCostDueDate(b), 'pt-BR')||String(a.name||'').localeCompare(String(b.name||''),'pt-BR'))){const occurrence=fixedCostOccurrenceMonth(item);if(occurrence>monthKey(today))continue;if(transactions.some(t=>String(t.fixedCostId)===String(item.id)&&String(t.fixedCostMonthKey||'')===occurrence))continue;const cents=Math.round((Number(item.amount)||0)*100);if(cents<=0)continue;const [occurrenceYear,occurrenceMonth]=occurrence.split('-').map(Number);const windowStart=dateISO(new Date(occurrenceYear,occurrenceMonth-2,1));const windowEnd=occurrence===monthKey(today)?dateISO(today):dateISO(new Date(occurrenceYear,occurrenceMonth,0));const match=transactions.filter(t=>{const transactionDate=String(t.date||'');const inPaymentWindow=transactionDate>=windowStart&&transactionDate<=windowEnd;const sameMonth=transactionDate.slice(0,7)===occurrence;const amountMatches=Math.round((Number(t.amount)||0)*100)===cents;const descriptionMatches=fixedCostBankDescriptionMatches(item,t);return t.type==='expense'&&!t.fixedCostId&&!t.statementBatchId&&t.paymentMethod!=='cartao'&&!t.cardId&&inPaymentWindow&&((sameMonth&&amountMatches)||descriptionMatches)&&!claimed.has(String(t.id));}).sort((a,b)=>String(a.date).localeCompare(String(b.date))||Number(a.createdAt||0)-Number(b.createdAt||0))[0];if(!match)continue;match.fixedCostId=String(item.id);match.fixedCostMonthKey=occurrence;match.fixedCostAutoMatched=true;claimed.add(String(match.id));changed=true;}if(changed)saveTransactions();}
  function renderFinancialAlerts(currentCardInvoice,currentInvestmentBalance,cardBudget){
    const container=$('#financialAlertList'),summary=$('#planCoachSummary'),grid=$('#planCoachGrid');
    container.replaceChildren();grid.replaceChildren();
    const alerts=[],fixedAmount=fixedMonthlyTotal(),investmentAmount=Number(currentInvestmentBalance)||0;
    const plan=[
      {key:'fixed',name:'Custos fixos',share:allocation.fixed/100,amount:fixedAmount,type:'limit'},
      {key:'card',name:'Cartão de crédito',share:allocation.card/100,targetAmount:Math.max(0,Number(cardBudget)||0),amount:Number(currentCardInvoice)||0,type:'limit'},
      {key:'investment',name:'Investimentos',share:allocation.investment/100,amount:investmentAmount,type:'goal'}
    ];
    const lastDay=new Date(today.getFullYear(),today.getMonth()+1,0).getDate();
    const planTarget=item=>Number.isFinite(Number(item.targetAmount))?Number(item.targetAmount):monthlyIncome*item.share;
    const investmentTarget=planTarget(plan.find(item=>item.key==='investment')),investmentMissedAtMonthEnd=today.getDate()===lastDay&&investmentAmount<investmentTarget;
    const deviations=monthlyIncome>0?plan.filter(item=>item.key==='investment'?item.amount>planTarget(item)||investmentMissedAtMonthEnd:item.amount>planTarget(item)):[];
    const near=plan.filter(item=>item.type==='limit'&&item.amount>=planTarget(item)*.8&&item.amount<=planTarget(item));
    const mascot=$('#alladinMascot'),mascotMood=monthlyIncome<=0||deviations.length===1?'thinking':deviations.length>1?'sad':'happy';
    const mascotMessage=monthlyIncome<=0?'Alladin precisa da sua renda para avaliar o plano':mascotMood==='happy'?'Alladin está feliz: tudo dentro do planejado':mascotMood==='sad'? 'Alladin está triste: '+deviations.length+' indicadores fora do planejado':'Alladin está pensativo: 1 indicador fora do planejado';
    mascot.dataset.mood=mascotMood;mascot.setAttribute('aria-label',mascotMessage);mascot.querySelector('.alladin-mood-label').textContent=mascotMood==='happy'?'Tudo no planejado':mascotMood==='sad'?deviations.length+' indicadores fora':'Acompanhando o plano';
    if(monthlyIncome<=0)summary.textContent=`Informe sua renda mensal para o Alladin acompanhar os limites de ${allocation.fixed}%, ${allocation.card}% e ${allocation.investment}%.`;
    else if(deviations.length)summary.textContent='O Alladin detectou valores acima do planejado. Confira os indicadores e avisos abaixo.';
    else if(near.length)summary.textContent='Atenção: '+near.map(item=>item.name).join(' e ')+' está(ão) próximo(s) do limite mensal.';
    else summary.textContent=`O plano ${allocation.fixed}/${allocation.card}/${allocation.investment} está dentro dos limites até agora. O Alladin continuará acompanhando.`;
    for(const item of plan){
      const target=planTarget(item),amount=item.amount,pct=target>0?Math.round(amount/target*100):0,sharePct=monthlyIncome>0?Math.round(amount/monthlyIncome*100):0;
      let state='Informe sua renda',stateClass='plan-monitor-neutral',detail=money(target)+' planejados';
      if(monthlyIncome>0){
        if(item.type==='limit'){
          if(amount>target){state='Acima do limite';stateClass='plan-monitor-over';detail='Passou '+money(amount-target);}
          else if(amount>=target*.8){state='Próximo do limite';stateClass='plan-monitor-near';detail='Restam '+money(target-amount);}
          else{state='Dentro do limite';stateClass='plan-monitor-ok';detail='Restam '+money(target-amount);}
        }else if(amount>target){state='Acima da meta';stateClass='plan-monitor-over';detail='Excedeu a meta em '+money(amount-target);}
        else if(amount<0){state='Resgates acima dos aportes';stateClass='plan-monitor-over';detail='Saldo líquido negativo de '+money(Math.abs(amount));}
        else if(amount>=target){state='Meta atingida';stateClass='plan-monitor-ok';detail='Meta mensal de '+money(target)+' atingida.';}
        else if(new Date(today.getFullYear(),today.getMonth(),today.getDate()).getDate()===lastDay){state='Meta não atingida';stateClass='plan-monitor-near';detail='Faltaram '+money(target-amount)+' para a meta.';}
        else{state='Meta em andamento';stateClass='plan-monitor-ok';detail='Faltam '+money(target-amount)+' para a meta.';}
      }
      const card=document.createElement('article');card.className='plan-monitor-card '+stateClass;
      const heading=document.createElement('div');heading.className='plan-monitor-heading';const name=document.createElement('strong');name.textContent=item.name;const share=document.createElement('span');share.textContent=Math.round(item.share*100)+'%';heading.append(name,share);
      const amountNode=document.createElement('strong');amountNode.className='plan-monitor-amount';amountNode.textContent=money(amount);
      const meta=document.createElement('span');meta.className='plan-monitor-meta';meta.textContent=monthlyIncome>0?sharePct+'% da renda · '+pct+'% do planejado':detail;
      const status=document.createElement('span');status.className='plan-monitor-status';status.textContent=state;
      const gap=document.createElement('small');gap.textContent=detail;
      card.append(heading,amountNode,meta,status,gap);grid.append(card);
    }
    const currentMonth=monthKey(today),dayMs=24*60*60*1000;
    for(const item of fixedCosts){
      const occurrenceMonth=fixedCostOccurrenceMonth(item);if(occurrenceMonth>currentMonth)continue;
      const paidAmount=fixedPaidForMonth(item,occurrenceMonth);const alertAmount=paidAmount||Number(item.amount)||0;if(paidAmount>0)continue;
      const due=parseDate(fixedCostDueDate(item)),daysUntil=Math.round((due-today)/dayMs);if(daysUntil>7)continue;
      if(daysUntil<0){const dueText=new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short'}).format(due).replace('.','');alerts.push({kind:'over',title:'Conta vencida',message:item.name+' venceu em '+dueText+' · '+money(alertAmount)});continue;}
      const when=daysUntil===0?'vence hoje':daysUntil===1?'vence amanhã':'vence em '+daysUntil+' dias';
      alerts.push({kind:'due',title:'Conta próxima de vencer',message:item.name+' '+when+' · '+money(alertAmount)});
    }
    const addLimitAlert=(nearTitle,overTitle,amount,limit,label)=>{if(limit<=0||amount<limit*.8)return;const percent=Math.round(amount/limit*100);alerts.push({kind:amount>=limit?'over':'limit',title:amount>=limit?overTitle:nearTitle,message:money(amount)+' de '+money(limit)+' '+label+' · '+percent+'%'});};
    addLimitAlert('Fixos vigentes próximos de atingir o limite','Limite de fixos vigentes atingido',fixedAmount,monthlyIncome*allocation.fixed/100,'utilizados');
    addLimitAlert('Cartão de crédito no mês próximo de atingir o limite','Limite mensal do cartão atingido',currentCardInvoice,Math.max(0,Number(cardBudget)||0),'utilizados');
    if(monthlyIncome>0&&investmentAmount>monthlyIncome*allocation.investment/100)alerts.push({kind:'over',title:`Aporte acima dos ${allocation.investment}% planejados`,message:money(investmentAmount)+' aportados líquidos · meta '+money(monthlyIncome*allocation.investment/100)});
    if(monthlyIncome>0&&today.getDate()===lastDay&&investmentAmount<monthlyIncome*allocation.investment/100)alerts.push({kind:'limit',title:'Meta mensal de investimento não atingida',message:`Faltaram ${money(monthlyIncome*allocation.investment/100-investmentAmount)} para os ${allocation.investment}% planejados.`});
    if(!alerts.length){const empty=document.createElement('p');empty.className='financial-alert-empty';empty.textContent='Nenhuma conta vencida ou próxima do vencimento e nenhum limite ultrapassado. O Alladin também avisa quando fixos ou cartão atingem 80% do planejado.';container.append(empty);return;}
    for(const alert of alerts){const card=document.createElement('article');card.className='financial-alert financial-alert-'+alert.kind;const icon=document.createElement('span');icon.className='financial-alert-icon';icon.textContent=alert.kind==='due'?'◷':alert.kind==='over'?'!':'↗';const content=document.createElement('div');content.className='financial-alert-content';const title=document.createElement('strong');title.textContent=alert.title;const message=document.createElement('span');message.textContent=alert.message;content.append(title,message);card.append(icon,content);container.append(card);}
  }
  function renderScheduledFixedCosts(){const container=$('#scheduledCostsList');container.replaceChildren();const currentMonth=monthKey(today);const visible=fixedCosts.filter(item=>{const occurrence=fixedCostOccurrenceMonth(item);if(occurrence>currentMonth)return false;const paid=fixedPaidForMonth(item,occurrence)>0;return occurrence===currentMonth||!paid;}).sort((a,b)=>fixedCostDueDate(a).localeCompare(fixedCostDueDate(b)));$('#scheduledCostsEmpty').hidden=visible.length>0;for(const item of visible){const occurrenceMonth=fixedCostOccurrenceMonth(item);const paidAmount=fixedPaidForMonth(item,occurrenceMonth);const paid=paidAmount>0;const dueDate=fixedCostDueDate(item);const due=parseDate(dueDate);const overdue=due<today&&!paid;const status=paid?'Pago':overdue?'Vencido':'A vencer';const statusType=paid?'paid':overdue?'overdue':'upcoming';const row=document.createElement('div');row.className=`transaction-row scheduled-cost-row${paid?' scheduled-cost-paid':''}`;const icon=document.createElement('span');icon.className=`transaction-icon ${paid?'income':'expense'}`;icon.textContent=paid?'✓':overdue?'!':'◷';const details=document.createElement('div');const name=document.createElement('div');name.className='transaction-name';name.textContent=item.name;const meta=document.createElement('div');meta.className='transaction-meta';meta.textContent=`Custo fixo · vence ${new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short'}).format(due).replace('.','')}`;details.append(name,meta);const amount=document.createElement('div');amount.className='scheduled-cost-value';const value=document.createElement('strong');value.textContent=paid?`− ${money(paidAmount)}`:money(item.amount);const statusIcon=document.createElement('span');statusIcon.className=`fixed-due-status ${statusType}`;statusIcon.textContent=paid?'✓':overdue?'!':'◷';statusIcon.title=status;statusIcon.setAttribute('role','img');statusIcon.setAttribute('aria-label',status);amount.append(value,statusIcon);row.append(icon,details,amount);if(!paid){const pay=document.createElement('button');pay.type='button';pay.className='button button-dark scheduled-pay-button';pay.textContent='Pagar';pay.setAttribute('aria-label',`Pagar ${item.name}`);pay.addEventListener('click',()=>openFixedPaymentAccount(item.id,occurrenceMonth));row.append(pay);}container.append(row);}return visible.length;}
  function getCardBankBrand(name){const value=String(name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();const brands=[['bradesco','bradesco','B'],['nubank','nubank','nu'],['itau','itaú','i'],['santander','santander','S'],['banco do brasil','Banco do Brasil','BB'],['caixa','CAIXA','X'],['inter','Inter','in'],['c6','C6 Bank','C6'],['sicredi','Sicredi','si'],['sicoob','Sicoob','co']];const found=brands.find(([key])=>value.includes(key));return found?{key:found[0].replaceAll(' ','-'),label:found[1],mark:found[2]}:{key:'generic',label:'MINHAS FINANÇAS',mark:'MF'};}
  function renderCards(){
    const list=$('#cardsList');list.replaceChildren();$('#cardsEmpty').hidden=cards.length>0;
    for(const card of cards){
      const currentMonth=monthKey(today);const spent=transactions.filter(t=>String(t.cardId)===String(card.id)).flatMap(t=>cardPaymentSchedule(t,card)).filter(payment=>payment.monthKey>=currentMonth).reduce((sum,payment)=>sum+payment.amount,0);
      const limit=Number(card.limit)||0;const pct=limit?Math.round(spent/limit*100):0;
      const item=document.createElement('article');item.className='credit-card-item';
      const visual=document.createElement('div');visual.className='credit-card-visual';
      const bank=getCardBankBrand(card.name);visual.classList.add(`bank-${bank.key}`);
      const visualTop=document.createElement('div');visualTop.className='credit-card-visual-top';const chip=document.createElement('span');chip.className='credit-card-chip';chip.setAttribute('aria-hidden','true');chip.textContent='▦';const bankLogo=document.createElement('span');bankLogo.className='credit-card-bank-logo';const bankMark=document.createElement('i');bankMark.textContent=bank.mark;const bankName=document.createElement('strong');bankName.textContent=bank.label;bankLogo.append(bankMark,bankName);visualTop.append(chip,bankLogo);
      const visualBottom=document.createElement('div');visualBottom.className='credit-card-visual-bottom';const mask=document.createElement('span');mask.className='credit-card-mask';mask.textContent='••••  ••••  ••••  ••••';const holder=document.createElement('strong');holder.textContent=card.name;visualBottom.append(mask,holder);visual.append(visualTop,visualBottom);
      const info=document.createElement('div');info.className='credit-card-info';
      const title=document.createElement('div');title.className='credit-card-title';const name=document.createElement('strong');name.textContent=card.name;const edit=document.createElement('button');edit.type='button';edit.className='row-action';edit.textContent='Editar';edit.addEventListener('click',()=>openCardEdit(card.id));const del=document.createElement('button');del.type='button';del.className='row-action row-delete';del.textContent='Remover';del.addEventListener('click',()=>removeCard(card.id));title.append(name,edit,del);
      const desc=document.createElement('span');desc.className='card-detail';desc.textContent=`Fecha dia ${cardClosingDay(card)} · Vence dia ${card.dueDay} · Limite ${money(limit)}`;
      const bar=document.createElement('div');bar.className='card-limit-track';const fill=document.createElement('div');fill.className='card-limit-fill';fill.style.width=`${Math.min(pct,100)}%`;if(pct>100)fill.classList.add('over');bar.append(fill);
      const bottom=document.createElement('div');bottom.className='card-limit-label';const used=document.createElement('span');used.textContent=`Utilizado: ${money(spent)} · ${pct}% do limite`;const available=document.createElement('strong');available.textContent=`${money(Math.max(limit-spent,0))} disponível`;bottom.append(used,available);
      info.append(title,desc,bar,bottom);item.append(visual,info);list.append(item);
    }
    const selector=$('#transactionCard');const selected=selector.value;selector.replaceChildren(new Option('Sem cartão',''));for(const card of cards)selector.add(new Option(card.name,String(card.id)));if(cards.some(c=>String(c.id)===selected))selector.value=selected;
    const statementSelector=$('#statementCardId');const statementSelected=statementSelector.value;statementSelector.replaceChildren(new Option(cards.length?'Selecione um cartão':'Cadastre um cartão primeiro',''));for(const card of cards)statementSelector.add(new Option(card.name,String(card.id)));if(cards.some(c=>String(c.id)===statementSelected))statementSelector.value=statementSelected;
  }
  function renderCardPurchases(){
    const container=$('#cardPurchasesList');container.replaceChildren();const selectedMonth=$('#cardMonthFilter').value||monthKey(today);
    for(const card of cards){
      const cardTransactions=transactions.filter(t=>String(t.cardId)===String(card.id));
      const purchases=cardTransactions.flatMap(transaction=>{
        if(transaction.statementBatchId)return cardPaymentSchedule(transaction,card);
        if(transaction.type!=='expense'&&!(transaction.type==='income'&&transaction.source==='MeuPluggy'))return[];
        return cardPaymentSchedule(transaction,card);
      }).filter(payment=>payment.monthKey===selectedMonth).sort((a,b)=>b.transaction.date.localeCompare(a.transaction.date));
      const bill=Array.isArray(card.pluggyBills)?card.pluggyBills.find(item=>String(item.monthKey)===selectedMonth):null;const hasInvoicePayment=purchases.some(payment=>isCardInvoicePayment(payment.transaction));const listedTotal=purchases.reduce((sum,payment)=>isCardInvoicePayment(payment.transaction)?sum:sum+payment.amount,0);const billTotal=bill?Number(bill.totalAmount):null;const useOfficialBill=Boolean(bill)&&!hasInvoicePayment&&Number.isFinite(billTotal)&&(Math.abs(billTotal)>0.005||Math.abs(listedTotal)<0.005);const total=useOfficialBill?billTotal:listedTotal,group=document.createElement('article');group.className='panel card-purchase-group';
      const heading=document.createElement('div');heading.className='card-purchase-heading';const title=document.createElement('div');const cardName=document.createElement('h2');cardName.textContent=card.name;const due=document.createElement('span');due.className='card-detail';due.textContent=`Fecha dia ${cardClosingDay(card)} · Vencimento dia ${card.dueDay} · Limite ${money(card.limit)}`;title.append(cardName,due);
      const monthTotal=document.createElement('div');monthTotal.className='card-month-total';const totalLabel=document.createElement('span');totalLabel.textContent=`Fatura · ${new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(new Date(`${selectedMonth}-02T12:00:00`))}${useOfficialBill?' · Open Finance':bill?' · estimada':''}`;const totalValue=document.createElement('strong');totalValue.textContent=money(total);monthTotal.append(totalLabel,totalValue);heading.append(title,monthTotal);group.append(heading);if(useOfficialBill){const billNote=document.createElement('p');billNote.className='card-detail';billNote.textContent='Total oficial da fatura retornado pela Pluggy. Os lançamentos detalhados aparecem abaixo.';group.append(billNote);}else if(bill||card.source==='MeuPluggy'){const billNote=document.createElement('p');billNote.className='card-detail';billNote.textContent='Fatura fechada ainda sem total disponível na Pluggy; valor estimado pela soma dos lançamentos deste período.';group.append(billNote);}
      const batches=new Map();for(const transaction of cardTransactions){if(transaction.statementBatchId&&String(transaction.statementMonth)===selectedMonth)batches.set(transaction.statementBatchId,transaction);}
      for(const transaction of batches.values()){
        if(transaction.statementFormat!=='pdf')continue;
        const check=document.createElement('div');const invoiceTotal=Number(transaction.statementInvoiceTotal),importedTotal=Number(transaction.statementImportedTotal);
        if(Number.isFinite(invoiceTotal)){const difference=invoiceTotal-importedTotal;const matches=Math.abs(difference)<=0.01;check.className=`card-invoice-check ${matches?'is-match':'is-mismatch'}`;check.textContent=matches?`Conferência da fatura PDF: bateu · Total ${money(invoiceTotal)} · Lançamentos ${money(importedTotal)}`:`Conferência da fatura PDF: não bateu · Total ${money(invoiceTotal)} · Lançamentos ${money(importedTotal)} · Diferença ${money(Math.abs(difference))}`;}
        else{check.className='card-invoice-check is-unknown';check.textContent=`Não localizei o total da fatura no PDF · Soma dos lançamentos identificados: ${money(importedTotal)}`;}
        group.append(check);
      }
      if(purchases.length){
        const table=document.createElement('div');table.className='purchase-rows';
        for(const payment of purchases){
          const purchase=payment.transaction,row=document.createElement('div');row.className='purchase-row';const info=document.createElement('div');info.className='purchase-description';const description=document.createElement('strong');description.textContent=purchase.description;const meta=document.createElement('span');
          const dateText=new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',year:'numeric'}).format(parseDate(purchase.date)).replace('.','');const parts=[purchase.category,dateText];if(Number(purchase.importedInstallmentCount)>1)parts.push(`Parcela ${purchase.importedInstallmentNumber||payment.installmentIndex}/${purchase.importedInstallmentCount}`);else if(payment.installmentCount>1)parts.push(`Parcela ${payment.installmentIndex}/${payment.installmentCount}`);if(isCardInvoicePayment(purchase))parts.push('Pagamento da fatura · fora do total');else if(purchase.type==='income'&&purchase.statementBatchId)parts.push('Estorno/crédito');meta.textContent=parts.join(' · ');info.append(description,meta);
          const amount=document.createElement('strong');amount.className=`purchase-amount ${payment.amount<0?'purchase-credit':''}`;amount.textContent=payment.amount<0?`− ${money(Math.abs(payment.amount))}`:money(payment.amount);
          const actions=document.createElement('div');actions.className='transaction-actions';const edit=document.createElement('button');edit.type='button';edit.className='row-action';edit.textContent='Editar';edit.addEventListener('click',()=>openEdit(purchase.id));const remove=document.createElement('button');remove.type='button';remove.className='row-action row-delete';remove.textContent='Apagar';remove.addEventListener('click',()=>deleteTransaction(purchase.id));actions.append(edit,remove);row.append(info,amount,actions);table.append(row);
        }
        group.append(table);
      }else{const empty=document.createElement('p');empty.className='card-month-empty';empty.textContent='Nenhuma compra ou parcela prevista para este mês.';group.append(empty);}
      container.append(group);
    }
    $('#cardPurchasesEmpty').hidden=cards.length>0;
  }  function renderCardInvoiceChart(){
    const legend=$('#cardInvoiceLegend'),chart=$('#cardInvoiceChart'),empty=$('#cardInvoiceEmpty'),yearSelect=$('#cardInvoiceYear');
    legend.replaceChildren();chart.replaceChildren();empty.hidden=true;
    const periodsByTransaction=transactions.filter(item=>item.cardId).map(transaction=>({transaction,periods:cardPaymentSchedule(transaction,cards.find(card=>String(card.id)===String(transaction.cardId))).map(payment=>payment.monthKey)}));
    const years=new Set([today.getFullYear()]);
    for(const entry of periodsByTransaction)for(const period of entry.periods){const year=Number(String(period).slice(0,4));if(Number.isInteger(year))years.add(year);}
    const priorYear=Number(yearSelect.value);yearSelect.replaceChildren();
    for(const year of [...years].sort((left,right)=>right-left)){const option=document.createElement('option');option.value=String(year);option.textContent=String(year);yearSelect.append(option);}
    const selectedYear=years.has(priorYear)?priorYear:today.getFullYear();yearSelect.value=String(selectedYear);
    if(!cards.length){empty.hidden=false;empty.textContent='Cadastre um cartão para consultar as faturas por mês.';return;}
    const palette=['#245b48','#d17d52','#527da8','#9a6ab0','#c39b35','#3d9b9a','#b75b68','#78845a'];
    const series=cards.map((card,index)=>({card,color:palette[index%palette.length]}));
    for(const item of series){const legendItem=document.createElement('span');legendItem.className='card-projection-legend-item';const swatch=document.createElement('i');swatch.className='card-projection-swatch';swatch.style.backgroundColor=item.color;const name=document.createElement('span');name.textContent=item.card.name;legendItem.append(swatch,name);legend.append(legendItem);}
    const months=Array.from({length:12},(_,index)=>new Date(selectedYear,index,1));
    const totalsByMonth=new Map(months.map(date=>[monthKey(date),new Map(cards.map(card=>[String(card.id),0]))]));
    const importedMonths=new Set(transactions.filter(item=>item.statementBatchId&&item.cardId&&String(item.statementMonth||'').startsWith(String(selectedYear))).map(item=>String(item.cardId)+'|'+String(item.statementMonth)));
    for(const {transaction,periods} of periodsByTransaction){
      const cardId=String(transaction.cardId);
      if(transaction.statementBatchId&&transaction.statementMonth){const month=String(transaction.statementMonth);if(!month.startsWith(String(selectedYear)))continue;const totals=totalsByMonth.get(month);if(totals)totals.set(cardId,(totals.get(cardId)||0)+Number(transaction.amount||0));continue;}
      const card=cards.find(item=>String(item.id)===cardId);if(!card)continue;
      for(const payment of cardPaymentSchedule(transaction,card)){if(!payment.monthKey.startsWith(String(selectedYear))||importedMonths.has(cardId+'|'+payment.monthKey))continue;const totals=totalsByMonth.get(payment.monthKey);if(totals)totals.set(cardId,(totals.get(cardId)||0)+Number(payment.amount||0));}
    }
    const monthRows=months.map(date=>{const cardTotals=totalsByMonth.get(monthKey(date));return{date,cardTotals,total:[...cardTotals.values()].reduce((sum,value)=>sum+value,0)};});
    const maxTotal=Math.max(0,...monthRows.map(item=>item.total));
    if(maxTotal<=0){empty.hidden=false;empty.textContent='Nenhuma fatura ou compra de cartão registrada para '+selectedYear+'.';return;}
    for(const item of monthRows){const column=document.createElement('div');column.className='card-projection-column';const total=document.createElement('strong');total.className='card-projection-total';total.textContent=money(item.total);const track=document.createElement('div');track.className='card-projection-track';const bar=document.createElement('div');bar.className='card-projection-bar';bar.style.height=item.total?String(Math.max(2,item.total/maxTotal*100))+'%':'0%';for(const entry of series){const amount=item.cardTotals.get(String(entry.card.id))||0;if(amount<=0)continue;const segment=document.createElement('span');segment.className='card-projection-segment';segment.style.height=String(amount/item.total*100)+'%';segment.style.backgroundColor=entry.color;segment.title=entry.card.name+': '+money(amount);segment.setAttribute('aria-label',entry.card.name+': '+money(amount));bar.append(segment);}track.append(bar);const label=document.createElement('span');label.className='card-projection-month';label.textContent=new Intl.DateTimeFormat('pt-BR',{month:'short'}).format(item.date).replace('.','');column.append(total,track,label);chart.append(column);}
  }
  function renderCardProjection(){
    const legend=$('#cardProjectionLegend');const chart=$('#cardProjectionChart');const empty=$('#cardProjectionEmpty');legend.replaceChildren();chart.replaceChildren();empty.hidden=true;
    if(!cards.length){empty.hidden=false;empty.textContent='Cadastre um cartão e registre compras para visualizar as despesas futuras.';return;}
    const palette=['#245b48','#d17d52','#527da8','#9a6ab0','#c39b35','#3d9b9a','#b75b68','#78845a'];const cardSeries=cards.map((card,index)=>({card,color:palette[index%palette.length]}));
    for(const series of cardSeries){const item=document.createElement('span');item.className='card-projection-legend-item';const swatch=document.createElement('i');swatch.className='card-projection-swatch';swatch.style.backgroundColor=series.color;const name=document.createElement('span');name.textContent=series.card.name;item.append(swatch,name);legend.append(item);}
    const months=Array.from({length:6},(_,index)=>new Date(today.getFullYear(),today.getMonth()+index+1,1));const monthTotals=new Map(months.map(date=>[monthKey(date),new Map(cards.map(card=>[String(card.id),0]))]));
    for(const transaction of transactions){if(transaction.type!=='expense'||!transaction.cardId)continue;const card=cards.find(item=>String(item.id)===String(transaction.cardId));if(!card)continue;for(const payment of cardPaymentSchedule(transaction,card)){const cardTotals=monthTotals.get(payment.monthKey);if(cardTotals)cardTotals.set(String(card.id),(cardTotals.get(String(card.id))||0)+payment.amount);}}
    const totals=months.map(date=>{const cardTotals=monthTotals.get(monthKey(date));return{date,cardTotals,total:[...cardTotals.values()].reduce((sum,value)=>sum+value,0)};});const maxTotal=Math.max(0,...totals.map(item=>item.total));
    if(maxTotal===0){empty.hidden=false;empty.textContent='Nenhuma compra ou parcela prevista para os próximos 6 meses.';return;}
    for(const item of totals){const column=document.createElement('div');column.className='card-projection-column';const total=document.createElement('strong');total.className='card-projection-total';total.textContent=money(item.total);const track=document.createElement('div');track.className='card-projection-track';const bar=document.createElement('div');bar.className='card-projection-bar';bar.style.height=`${item.total?Math.max(2,item.total/maxTotal*100):0}%`;for(const series of cardSeries){const amount=item.cardTotals.get(String(series.card.id))||0;if(amount<=0)continue;const segment=document.createElement('span');segment.className='card-projection-segment';segment.style.height=`${amount/item.total*100}%`;segment.style.backgroundColor=series.color;segment.title=`${series.card.name}: ${money(amount)}`;segment.setAttribute('aria-label',`${series.card.name}: ${money(amount)}`);bar.append(segment);}track.append(bar);const label=document.createElement('span');label.className='card-projection-month';label.textContent=new Intl.DateTimeFormat('pt-BR',{month:'short',year:'numeric'}).format(item.date).replace('.','');column.append(total,track,label);chart.append(column);}
  }
  function getAccumulatedInvestmentBalance(){const syncedCryptoInvested=getCryptoPositions().filter(item=>item.synced&&!item.manualCount).reduce((sum,item)=>sum+Number(item.amount||0),0);return investments.reduce((sum,item)=>sum+((item.movement||'contribution')==='withdrawal'?-1:1)*Number(item.amount||0),0)+syncedCryptoInvested;}
  function renderInvestments(){
    const selectedMonth=$('#investmentMonthFilter').value||monthKey(today);const monthItems=investments.filter(item=>String(item.date).slice(0,7)===selectedMonth).sort((a,b)=>b.date.localeCompare(a.date));const monthly=monthItems.filter(item=>(item.movement||'contribution')==='contribution').reduce((sum,item)=>sum+Number(item.amount||0),0);const accumulated=getAccumulatedInvestmentBalance();const target=monthlyIncome*allocation.investment/100;const pct=target?Math.round(monthly/target*100):0;$('#investmentIntroCopy').textContent=`Registre aportes e resgates e acompanhe a meta mensal de ${allocation.investment}% da renda.`;
    $('#investmentTargetValue').textContent=money(target);$('#investmentMonthValue').textContent=money(monthly);$('#investmentTotalValue').textContent=money(accumulated);$('#investmentProgressText').textContent=target<=0?'Informe sua renda na Visão geral':monthly>=target?`Meta mensal atingida (${pct}%)`:`${pct}% da meta mensal`;
    $('#investmentProgress').style.width=`${Math.min(pct,100)}%`;$('#investmentProgress').classList.toggle('over',target>0&&monthly>target);$('#investmentProgressTrack')?.setAttribute('aria-valuenow',String(Math.min(pct,100)));
    const labelDate=new Date(`${selectedMonth}-02T12:00:00`);$('#investmentMonthLabel').textContent=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(labelDate);renderInvestmentAnnualChart();
    const list=$('#investmentList');list.replaceChildren();$('#investmentEmpty').hidden=monthItems.length>0;
    for(const item of monthItems){const withdrawal=(item.movement||'contribution')==='withdrawal';const row=document.createElement('div');row.className=`investment-row${withdrawal?' investment-withdrawal':''}`;row.dataset.investmentId=String(item.id);const icon=document.createElement('span');icon.className='investment-icon';icon.textContent=withdrawal?'↓':'↗';const info=document.createElement('div');info.className='investment-info';const name=document.createElement('strong');name.textContent=item.name;const meta=document.createElement('span');meta.textContent=`${withdrawal?'Saída (resgate)':'Aporte'} · ${item.kind} · ${new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',year:'numeric'}).format(parseDate(item.date)).replace('.','')}`;info.append(name,meta);const values=document.createElement('div');values.className=item.kind==='Criptoativos'?'crypto-valuation':'investment-valuation';if(item.kind==='Criptoativos'){row.dataset.cryptoSymbol=item.symbol||'';row.dataset.cryptoQuantity=String(item.quantity||0);row.dataset.invested=String(item.amount);const invested=document.createElement('span');invested.className='invested-value';invested.textContent=`Investido ${money(item.amount)}`;const current=document.createElement('strong');current.className='current-crypto-value';current.textContent='Cotando na Binance…';const quoteMeta=document.createElement('small');quoteMeta.className='crypto-quote-meta';values.append(invested,current,quoteMeta);}else{const amount=document.createElement('strong');amount.className=`investment-amount${withdrawal?' withdrawal':''}`;amount.textContent=`${withdrawal?'− ':''}${money(item.amount)}`;values.append(amount);}const actions=document.createElement('div');actions.className='transaction-actions';const edit=document.createElement('button');edit.type='button';edit.className='row-action';edit.textContent='Editar';edit.addEventListener('click',()=>openInvestmentEdit(item.id));const remove=document.createElement('button');remove.type='button';remove.className='row-action row-delete';remove.textContent='Apagar';remove.addEventListener('click',()=>deleteInvestment(item.id));actions.append(edit,remove);row.append(icon,info,values,actions);list.append(row);}
  }
  function renderInvestmentAnnualChart(){const selector=$('#investmentYear'),chart=$('#investmentMonthlyChart');if(!selector||!chart)return;const movements=investments.filter(item=>Number(item.amount)>0),contributions=movements.filter(item=>(item.movement||'contribution')==='contribution'),withdrawals=movements.filter(item=>item.movement==='withdrawal');const currentYear=String(today.getFullYear()),years=[...new Set([currentYear,...movements.map(item=>String(item.date||'').slice(0,4)).filter(year=>/^\d{4}$/.test(year))])].sort((a,b)=>Number(b)-Number(a));const selected=years.includes(selector.value)?selector.value:currentYear;selector.replaceChildren(...years.map(year=>new Option(year,year)));selector.value=selected;const contributionTotals=Array(12).fill(0),withdrawalTotals=Array(12).fill(0);for(const item of contributions.concat(withdrawals)){const match=String(item.date||'').match(/^(\d{4})-(\d{2})/);if(!match||match[1]!==selected)continue;const month=Number(match[2]);if(month<1||month>12)continue;const target=item.movement==='withdrawal'?withdrawalTotals:contributionTotals;target[month-1]+=Number(item.amount)||0;}$('#investmentYearTotal').textContent=money(contributionTotals.reduce((sum,value)=>sum+value,0));$('#investmentYearWithdrawnTotal').textContent=money(withdrawalTotals.reduce((sum,value)=>sum+value,0));chart.replaceChildren();const maximum=Math.max(0,...contributionTotals,...withdrawalTotals);for(let index=0;index<12;index++){const monthName=new Intl.DateTimeFormat('pt-BR',{month:'long'}).format(new Date(Number(selected),index,2));const column=document.createElement('div');column.className='investment-month-column';column.setAttribute('aria-label',`${monthName}: ${money(contributionTotals[index])} aportados e ${money(withdrawalTotals[index])} resgatados`);const amounts=document.createElement('div');amounts.className='investment-month-values';for(const [prefix,value] of [['A',contributionTotals[index]],['R',withdrawalTotals[index]]]){const amount=document.createElement('small');amount.className='investment-month-value';amount.textContent=`${prefix} ${value?money(value):'—'}`;amount.title=`${prefix==='A'?'Aportado':'Resgatado'}: ${money(value)}`;amounts.append(amount);}const track=document.createElement('div');track.className='investment-month-track';for(const [value,className] of [[contributionTotals[index],'investment-contribution-bar'],[withdrawalTotals[index],'investment-withdrawal-bar']]){const bar=document.createElement('div');bar.className=`investment-month-bar ${className}`;bar.style.height=maximum&&value?`${Math.max(2,value/maximum*100)}%`:'0%';track.append(bar);}const label=document.createElement('span');label.textContent=new Intl.DateTimeFormat('pt-BR',{month:'short'}).format(new Date(Number(selected),index,2)).replace('.','');column.append(amounts,track,label);chart.append(column);}}
  function getCryptoPositions(){const manual=investments.filter(item=>item.kind==='Criptoativos');const grouped=new Map();for(const item of manual){const symbol=canonicalCryptoSymbol(item.symbol);if(!symbol)continue;const position=grouped.get(symbol)||{id:'crypto-position-'+symbol,symbol,name:symbol,amount:0,quantity:0,manualCount:0,synced:false};position.amount+=Number(item.amount)||0;position.quantity+=Number(item.quantity)||0;position.manualCount++;grouped.set(symbol,position);}const snapshot=selectedCryptoSnapshot();for(const balance of snapshot?.balances||[]){const symbol=canonicalCryptoSymbol(balance.asset);if(!symbol||['BRL','USD','EUR','GBP','CAD','JPY'].includes(symbol)||Number(balance.total)<=0)continue;const position=grouped.get(symbol)||{id:'crypto-position-'+symbol,symbol,name:symbol,amount:0,quantity:0,manualCount:0,synced:false};position.quantity+=Number(balance.total)||0;position.synced=true;position.exchange=snapshot.exchange||'binance';if(!position.manualCount){position.amount=Number(balance.investedBRL)||0;position.investedSource=balance.source||null;position.purchaseDate=balance.purchaseDate||null;}grouped.set(symbol,position);}return [...grouped.values()].sort((a,b)=>a.symbol.localeCompare(b.symbol));}
    function renderCryptoPortfolio(){const positions=getCryptoPositions();const snapshot=selectedCryptoSnapshot();const syncState=$('#binanceConnectionState');if(syncState)syncState.textContent=snapshot?.updatedAt?'Sincronizada':'N\u00e3o sincronizada';const list=$('#cryptoPortfolioList');list.replaceChildren();$('#cryptoPortfolioEmpty').hidden=positions.length>0;const registeredCryptoInvested=investments.filter(item=>item.kind==='Criptoativos'&&(item.movement||'contribution')==='contribution').reduce((sum,item)=>sum+Number(item.amount||0),0);const syncedCryptoInvested=positions.filter(item=>item.synced&&!item.manualCount).reduce((sum,item)=>sum+Number(item.amount||0),0);cryptoPortfolioInvestedTotal=registeredCryptoInvested+syncedCryptoInvested;$('#cryptoInvestedTotal').textContent=money(cryptoPortfolioInvestedTotal);$('#cryptoCurrentTotal').textContent=positions.length?'Consultando...':money(0);$('#cryptoProfitTotal').innerHTML='Resultado <strong>Calculando...</strong>';$('#cryptoProfitTotal').className='profit-neutral';const description=$('#cryptoPortfolioDescription');const exchangeName=cryptoExchangeOptions[snapshot?.exchange||'binance']?.name||'corretora';if(description)description.textContent=snapshot?.updatedAt?`Posição sincronizada com ${exchangeName} em ${new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(snapshot.updatedAt))}. O valor investido considera aportes registrados. O histórico de compras automático está disponível para Binance.`:'Escolha a corretora, cadastre uma chave somente leitura e sincronize; os saldos aparecem nesta aba.';for(const item of positions){const row=document.createElement('div');row.className='crypto-portfolio-row';row.dataset.investmentId=String(item.id);row.dataset.cryptoSymbol=item.symbol;row.dataset.cryptoQuantity=String(item.quantity);row.dataset.invested=String(item.amount);const info=document.createElement('div');info.className='crypto-position-info';const name=document.createElement('strong');name.textContent=item.symbol;const quantity=document.createElement('span');quantity.textContent=`${Number(item.quantity).toLocaleString('pt-BR',{maximumFractionDigits:8})} ${item.symbol} · ${item.synced?'saldo sincronizado da '+(cryptoExchangeOptions[item.exchange]?.name||'corretora'):'quantidade registrada'}`;info.append(name,quantity);const values=document.createElement('div');values.className='crypto-position-values';const invested=document.createElement('span');invested.className='invested-value';invested.textContent=item.manualCount||item.synced&&item.amount>0?'Investido '+money(item.amount):'Investido n\u00e3o registrado';invested.title=item.manualCount?'Valor dos aportes registrados nesta aplicacao.':item.purchaseDate?(item.investedSource==='historical-estimate'?'Estimativa pela cotacao historica. ':'Custo calculado pelo historico de compras Binance. ')+'Compra mais recente: '+new Intl.DateTimeFormat('pt-BR',{dateStyle:'long'}).format(new Date(item.purchaseDate)):'Sem historico de compra disponivel na Binance para calcular o custo.';const current=document.createElement('strong');current.className='current-crypto-value';current.textContent='Consultando Binance…';const performance=document.createElement('strong');performance.className='crypto-performance';performance.textContent='Resultado pendente';const meta=document.createElement('small');meta.className='crypto-quote-meta';values.append(invested,current,performance,meta);row.append(info,values);list.append(row);}updateCryptoQuoteRows(positions);updateCryptoQuoteRows(investments.filter(item=>item.kind==='Criptoativos'),false,false);}
  function canonicalCryptoSymbol(symbol){const value=String(symbol||'').toUpperCase().replace(/[^A-Z0-9]/g,'');return value==='LDKERNEL'?'KERNEL':value;}
  async function binanceTickerPrice(symbol){const url=`https://data-api.binance.vision/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`;const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),9000);try{const response=await fetch(url,{signal:controller.signal,cache:'no-store',mode:'cors'});if(!response.ok)throw new Error('Cotação indisponível');const data=await response.json();const price=Number(data.price);if(!Number.isFinite(price)||price<=0)throw new Error('Cotação inválida');return price;}finally{clearTimeout(timer);}}
  async function getCryptoPriceBRL(baseAsset,force=false){const base=canonicalCryptoSymbol(baseAsset);if(!base)throw new Error('Informe o ticker da cripto.');const cached=cryptoQuoteCache.get(base);if(!force&&cached&&Date.now()-cached.time<30000)return cached; if(cryptoQuoteRequests.has(base))return cryptoQuoteRequests.get(base);const request=(async()=>{try{let price;let quote='BRL';try{price=await binanceTickerPrice(`${base}BRL`);}catch{quote='USDT';const [coinPrice,usdtPrice]=await Promise.all([binanceTickerPrice(`${base}USDT`),binanceTickerPrice('USDTBRL')]);price=coinPrice*usdtPrice;}const result={price,quote,time:Date.now()};cryptoQuoteCache.set(base,result);return result;}finally{cryptoQuoteRequests.delete(base);}})();cryptoQuoteRequests.set(base,request);return request;}
  async function updateCryptoQuoteRows(cryptoItems,force=false,updateTotal=true){let currentTotal=0;let failed=0;await Promise.all(cryptoItems.map(async item=>{const rows=[...document.querySelectorAll('.investment-row,.crypto-portfolio-row')].filter(node=>node.dataset.investmentId===String(item.id));if(!rows.length)return;try{const quote=await getCryptoPriceBRL(item.symbol,force);const current=Number(item.quantity)*quote.price;currentTotal+=current;for(const row of rows){const value=row.querySelector('.current-crypto-value');const meta=row.querySelector('.crypto-quote-meta');if(!row.isConnected)continue;value.textContent=`Atual ${money(current)}`;meta.textContent=`${Number(item.quantity).toLocaleString('pt-BR',{maximumFractionDigits:8})} ${canonicalCryptoSymbol(item.symbol)} · Binance ${quote.quote} · ${new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(new Date(quote.time))}`;const performance=row.querySelector('.crypto-performance');const basis=Number(item.amount)||0;const difference=current-basis;if(performance){if(basis>0){performance.textContent=difference>0?'Lucro +'+money(difference):difference<0?'Preju\u00edzo -'+money(Math.abs(difference)):'Sem varia\u00e7\u00e3o '+money(0);performance.classList.toggle('profit-positive',difference>0);performance.classList.toggle('profit-negative',difference<0);performance.classList.toggle('profit-neutral',difference===0);}else{performance.textContent='Sem base para calcular';performance.classList.remove('profit-positive','profit-negative');performance.classList.add('profit-neutral');}}value.classList.toggle('crypto-gain',current>=Number(item.amount));value.classList.toggle('crypto-loss',current<Number(item.amount));}}catch{failed++;for(const row of rows){if(!row.isConnected)continue;row.querySelector('.current-crypto-value').textContent='Cotação indisponível';row.querySelector('.crypto-quote-meta').textContent='Confira o ticker e tente atualizar novamente.';const performance=row.querySelector('.crypto-performance');if(performance){performance.textContent='Sem base para calcular';performance.classList.remove('profit-positive','profit-negative');performance.classList.add('profit-neutral');}}}}));if(updateTotal){$('#cryptoCurrentTotal').textContent=failed?money(currentTotal)+' - parcial':money(currentTotal);const result=$('#cryptoProfitTotal');if(failed){result.innerHTML='Resultado <strong>Cota\u00e7\u00f5es parciais</strong>';result.className='profit-neutral';}else if(cryptoPortfolioInvestedTotal<=0){result.innerHTML='Resultado <strong>Sem base de investimento</strong>';result.className='profit-neutral';}else{const difference=currentTotal-cryptoPortfolioInvestedTotal;result.innerHTML=difference>0?'Lucro <strong>+'+money(difference)+'</strong>':difference<0?'Preju\u00edzo <strong>- '+money(Math.abs(difference))+'</strong>':'Sem varia\u00e7\u00e3o <strong>'+money(0)+'</strong>';result.className=difference>0?'profit-positive':difference<0?'profit-negative':'profit-neutral';}}}
  function renderFixedCosts(){
    const list=$('#fixedCostList');list.replaceChildren();const selectedMonth=$('#fixedCostMonthFilter').value||monthKey(today);const visibleCosts=fixedCosts.filter(item=>!item.monthKey||item.monthKey===selectedMonth);$('#fixedEmpty').hidden=visibleCosts.length>0;$('#fixedCount').textContent=String(visibleCosts.length);
    const paidFor=item=>fixedPaidForMonth(item,selectedMonth);
    const allowance=monthlyIncome*allocation.fixed/100;const total=visibleCosts.reduce((sum,item)=>sum+(Number(item.amount)||0),0);const paidTotal=visibleCosts.reduce((sum,item)=>sum+paidFor(item),0);const pct=allowance?Math.round(total/allowance*100):0;
    $('#fixedAllowanceValue').textContent=money(allowance);$('#fixedTotalValue').textContent=money(total);$('#fixedCapacity').textContent=`${pct}% do limite`;
    $('#fixedProgress').style.width=`${Math.min(pct,100)}%`;$('#fixedProgress').classList.toggle('over',allowance>0&&total>allowance);
    const allowanceText=allowance<=0?'Informe sua renda na Visão geral':total>allowance?`Passou ${money(total-allowance)} do limite de ${allocation.fixed}%`:`Restam ${money(allowance-total)} dos ${allocation.fixed}%`;$('#fixedRemainingLabel').textContent=`Pago no mês: ${money(paidTotal)} · ${allowanceText}`;
    for(const item of [...visibleCosts].sort((a,b)=>fixedCostDueDate(a).localeCompare(fixedCostDueDate(b),'pt-BR')||String(a.name||'').localeCompare(String(b.name||''),'pt-BR'))){
      const row=document.createElement('div');row.className='fixed-cost-row';const icon=document.createElement('span');icon.className='fixed-cost-icon';icon.textContent='↻';
      const info=document.createElement('div');info.className='fixed-cost-info';const name=document.createElement('strong');name.textContent=item.name;const due=document.createElement('span');const installmentLabel=item.monthKey?`Parcela ${item.installmentIndex}/${item.installmentCount} · ${new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(new Date(`${item.monthKey}-02T12:00:00`))}`:'Recorrente';due.textContent=`${installmentLabel} · vence dia ${item.dueDay}`;info.append(name,due);
      const values=document.createElement('div');values.className='fixed-cost-values';const principal=document.createElement('div');principal.className='fixed-cost-value-block';const principalLabel=document.createElement('span');principalLabel.textContent='Valor principal';const principalAmount=document.createElement('strong');principalAmount.textContent=money(item.amount);principal.append(principalLabel,principalAmount);const paid=document.createElement('div');paid.className='fixed-cost-value-block fixed-cost-paid';const paidLabel=document.createElement('span');paidLabel.textContent='Pago no mês';const paidAmount=document.createElement('strong');paidAmount.textContent=money(paidFor(item));paid.append(paidLabel,paidAmount);values.append(principal,paid);
      const actions=document.createElement('div');actions.className='transaction-actions';const paidEdit=document.createElement('button');paidEdit.type='button';paidEdit.className='row-action';paidEdit.textContent='Editar pago';paidEdit.setAttribute('aria-label',`Editar valor pago de ${item.name} em ${selectedMonth}`);paidEdit.addEventListener('click',()=>openFixedPaidEdit(item.id,selectedMonth));const edit=document.createElement('button');edit.type='button';edit.className='row-action';edit.textContent='Editar';edit.addEventListener('click',()=>openFixedEdit(item.id));const remove=document.createElement('button');remove.type='button';remove.className='row-action row-delete';remove.textContent='Apagar';remove.addEventListener('click',()=>deleteFixedCost(item.id));actions.append(paidEdit,edit,remove);row.append(icon,info,values,actions);list.append(row);
    }
  }
  function renderFixedAnnualChart(){
    const selector=$('#fixedPaidYear'),chart=$('#fixedPaidChart');if(!selector||!chart)return;
    const paidTransactions=transactions.filter(item=>item.fixedCostId&&Number(item.amount)>0);
    const currentYear=String(today.getFullYear()),years=[...new Set([currentYear,...paidTransactions.map(item=>String(item.fixedCostMonthKey||item.date||'').slice(0,4)).filter(year=>/^\d{4}$/.test(year))])].sort((a,b)=>Number(b)-Number(a));
    const selected=years.includes(selector.value)?selector.value:currentYear;selector.replaceChildren(...years.map(year=>new Option(year,year)));selector.value=selected;
    const totals=Array(12).fill(0);
    for(const item of paidTransactions){const key=String(item.fixedCostMonthKey||item.date||'').slice(0,7),match=key.match(/^(\d{4})-(\d{2})$/);if(!match||match[1]!==selected)continue;const month=Number(match[2]);if(month>=1&&month<=12)totals[month-1]+=Number(item.amount)||0;}
    for(const item of fixedCosts)for(const [key,value] of Object.entries(item.paidOverrides||{})){const match=key.match(/^(\d{4})-(\d{2})$/);if(!match||match[1]!==selected)continue;const month=Number(match[2]);if(month<1||month>12)continue;const actual=transactions.filter(t=>t.type==='expense'&&String(t.fixedCostId)===String(item.id)&&String(t.fixedCostMonthKey||t.date||'').slice(0,7)===key).reduce((sum,t)=>sum+(Number(t.amount)||0),0);totals[month-1]+=Math.max(0,Number(value)||0)-actual;}
    $('#fixedPaidYearTotal').textContent=money(totals.reduce((sum,value)=>sum+value,0));chart.replaceChildren();const maximum=Math.max(...totals,0);
    for(let index=0;index<12;index++){const column=document.createElement('div');column.className='fixed-paid-column';column.setAttribute('aria-label',`${new Intl.DateTimeFormat('pt-BR',{month:'long'}).format(new Date(Number(selected),index,2))}: ${money(totals[index])} pagos`);const amount=document.createElement('small');amount.className='fixed-paid-value';amount.textContent=totals[index]?money(totals[index]):'—';const track=document.createElement('div');track.className='fixed-paid-track';const bar=document.createElement('div');bar.className='fixed-paid-bar';bar.style.height=maximum?`${totals[index]?Math.max(2,totals[index]/maximum*100):0}%`:'0%';track.append(bar);const label=document.createElement('span');label.textContent=new Intl.DateTimeFormat('pt-BR',{month:'short'}).format(new Date(Number(selected),index,2)).replace('.','');column.append(amount,track,label);chart.append(column);}
  }
  let generatedReport = null;
  function renderReport(){
    const selectedTypes=[['fixed',$('#reportFixed').checked],['cards',$('#reportCards').checked],['investments',$('#reportInvestments').checked],['banking',$('#reportBanking').checked]].filter(item=>item[1]).map(item=>item[0]);if(!selectedTypes.length){showToast('Selecione ao menos uma categoria.');return;}
    const selectedMonth=$('#reportMonth').value||monthKey(today);const [year,month]=selectedMonth.split('-').map(Number);const period=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(new Date(year,month-1,2));const moneyText=value=>money(Number(value)||0);
    const headers=['Categoria','Data','Descri\u00e7\u00e3o','Detalhe','Valor principal','Valor relacionado','Situa\u00e7\u00e3o'];const rows=[],summary=[];
    if(selectedTypes.includes('fixed')){const items=fixedCosts.filter(item=>!item.monthKey||item.monthKey===selectedMonth).map(item=>{const payments=transactions.filter(t=>String(t.fixedCostId)===String(item.id)&&String(t.fixedCostMonthKey||'')===selectedMonth);const planned=Number(item.amount)||0,paid=fixedPaidForMonth(item,selectedMonth),dueDay=Math.min(Number(item.dueDay)||1,new Date(year,month,0).getDate());return{item,planned,paid,payments,date:dateISO(new Date(year,month-1,dueDay))};}).sort((a,b)=>a.date.localeCompare(b.date));for(const entry of items)rows.push(['Custos fixos',entry.date,entry.item.name,'Vencimento dia '+entry.item.dueDay,entry.planned,entry.paid,entry.paid>=entry.planned&&entry.planned>0?'Pago':entry.paid>0?'Parcial':'Pendente']);const planned=items.reduce((sum,row)=>sum+row.planned,0),paid=items.reduce((sum,row)=>sum+row.paid,0);summary.push(['Fixos · previsto',moneyText(planned)],['Fixos · pago',moneyText(paid)],['Fixos · em aberto',moneyText(Math.max(0,planned-paid))]);}
    if(selectedTypes.includes('cards')){const cardRows=[];for(const transaction of transactions){if(transaction.type!=='expense'||(transaction.paymentMethod!=='cartao'&&!transaction.cardId))continue;const card=cards.find(item=>String(item.id)===String(transaction.cardId));for(const payment of cardPaymentSchedule(transaction,card)){if(payment.monthKey!==selectedMonth)continue;cardRows.push([transaction.date,card?.name||'Cart\u00e3o sem cadastro',transaction.description||'Compra',payment.installmentCount>1?'Parcela '+payment.installmentIndex+'/'+payment.installmentCount:'\u00c0 vista',payment.amount,Number(transaction.amount)||0]);}}cardRows.sort((a,b)=>a[0].localeCompare(b[0]));for(const row of cardRows)rows.push(['Cart\u00f5es',row[0],row[2],row[1]+' · '+row[3],row[4],row[5],'Previsto na fatura']);summary.push(['Cart\u00f5es · compras e parcelas',moneyText(cardRows.reduce((sum,row)=>sum+row[4],0))],['Cart\u00f5es · lan\u00e7amentos',String(cardRows.length)]);}
    if(selectedTypes.includes('investments')){const items=investments.filter(item=>String(item.date||'').slice(0,7)===selectedMonth).sort((a,b)=>String(a.date).localeCompare(String(b.date)));let contributions=0,withdrawals=0;for(const item of items){const withdrawal=(item.movement||'contribution')==='withdrawal',value=Number(item.amount)||0,signed=(withdrawal?-1:1)*value;if(withdrawal)withdrawals+=value;else contributions+=value;rows.push(['Investimentos',item.date,item.name||'Investimento',item.kind||'',signed,'',withdrawal?'Resgate':'Aporte']);}summary.push(['Investimentos · aportes',moneyText(contributions)],['Investimentos · resgates',moneyText(withdrawals)],['Investimentos · saldo l\u00edquido',moneyText(getAccumulatedInvestmentBalance())]);}
    if(selectedTypes.includes('banking')){const account=bankAccounts.find(item=>String(item.id)===String(selectedBankAccountId))||bankAccounts[0]||{id:'main',name:'Conta principal'};const accountId=String(account.id);const accountRows=transactions.filter(t=>!t.statementBatchId&&t.paymentMethod!=='cartao'&&!t.cardId&&transactionBankAccountId(t)===accountId&&String(t.date||'').slice(0,7)===selectedMonth).sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));const accountTransactions=transactions.filter(t=>!t.statementBatchId&&t.paymentMethod!=='cartao'&&!t.cardId&&transactionBankAccountId(t)===accountId);updateOpeningBalanceFromStatement(accountTransactions);const previousMonthKey=monthKey(new Date(year,month-2,1));const opening=getBankClosingBalance(previousMonthKey,accountTransactions,accountId);let bankIncome=0,bankExpense=0;for(const transaction of accountRows){const value=Number(transaction.amount)||0;const isIncome=transaction.type==='income';if(isIncome)bankIncome+=value;else bankExpense+=value;rows.push(['Transações bancárias',transaction.date,transaction.description||'Transação',[account.name,transaction.category||'Sem categoria'].filter(Boolean).join(' · '),value,'',isIncome?'Entrada':'Saída']);}const closingOverride=bankBalanceOverride(accountId,selectedMonth);const closing=closingOverride!==null?closingOverride:opening+bankIncome-bankExpense;summary.push(['Banco · saldo inicial',moneyText(opening)],['Banco · entradas no mês',moneyText(bankIncome)],['Banco · saídas no mês',moneyText(bankExpense)],['Banco · saldo atual',moneyText(closing)]);}
    const selectedLabel=selectedTypes.map(type=>type==='fixed'?'Custos fixos':type==='cards'?'Cart\u00f5es':type==='investments'?'Investimentos':'Transações bancárias').join(' + ');$('#reportTitle').textContent=selectedTypes.length>1?'Relat\u00f3rio financeiro consolidado':'Relat\u00f3rio de '+selectedLabel;$('#reportPeriod').textContent=period;$('#reportGeneratedAt').textContent=new Intl.DateTimeFormat('pt-BR',{dateStyle:'medium',timeStyle:'short'}).format(new Date());$('#reportCategories').textContent=selectedLabel;$('#reportMetadata').hidden=false;$('#reportDetailHeading').hidden=rows.length===0;$('#reportRowCount').textContent=rows.length+' '+(rows.length===1?'lan\u00e7amento':'lan\u00e7amentos');const summaryRoot=$('#reportSummary');summaryRoot.replaceChildren();const summaryGroups=new Map();for(const entry of summary){const group=entry[0].startsWith('Fixos')?'Custos fixos':entry[0].startsWith('Cart')?'Cartões':entry[0].startsWith('Banco')?'Transações bancárias':'Investimentos';if(!summaryGroups.has(group))summaryGroups.set(group,[]);summaryGroups.get(group).push(entry);}for(const [group,entries] of summaryGroups){const section=document.createElement('section');section.className='report-summary-group';const heading=document.createElement('h3');heading.textContent=group;const cards=document.createElement('div');cards.className='report-summary-group-cards';for(const [label,value] of entries){const card=document.createElement('article');card.className='summary-card report-summary-card';const caption=document.createElement('span');caption.textContent=label;const amount=document.createElement('strong');amount.textContent=value;card.append(caption,amount);cards.append(card);}section.append(heading,cards);summaryRoot.append(section);}summaryRoot.hidden=false;
    const table=$('#reportTable');table.replaceChildren();const head=document.createElement('thead'),headRow=document.createElement('tr');for(const label of headers){const th=document.createElement('th');th.scope='col';th.textContent=label;headRow.append(th);}head.append(headRow);table.append(head);const body=document.createElement('tbody');for(const values of rows){const tr=document.createElement('tr');for(let index=0;index<values.length;index++){const td=document.createElement('td'),value=values[index];td.textContent=typeof value==='number'&&(index===4||index===5)?money(value):String(value??'-');tr.append(td);}body.append(tr);}table.append(body);
    $('#reportTableWrap').hidden=rows.length===0;$('#reportEmpty').hidden=rows.length>0;$('#reportEmpty p').textContent='Nenhum registro encontrado para as categorias e o m\u00eas selecionados.';generatedReport={type:selectedTypes.join('-'),selectedLabel,selectedMonth,headers,rows,summary,generatedAt:new Date().toISOString()};$('#downloadReport').hidden=rows.length===0;$('#downloadReportPdf').hidden=rows.length===0;
  }
  function downloadReportCsv(){if(!generatedReport)return;const csvCell=value=>'"'+String(value??'').replace(/"/g,'""')+'"';const content='\uFEFF'+[generatedReport.headers,...generatedReport.rows].map(row=>row.map(csvCell).join(';')).join('\r\n');const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='relatorio-'+generatedReport.type+'-'+generatedReport.selectedMonth+'.csv';document.body.append(link);link.click();link.remove();URL.revokeObjectURL(url);}
  function downloadReportPdf(){
    if(!generatedReport)return;
    const popup=window.open('','_blank');
    if(!popup){showToast('Permita a abertura da janela para gerar o PDF.');return;}
    const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const period=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(new Date(Number(generatedReport.selectedMonth.slice(0,4)),Number(generatedReport.selectedMonth.slice(5,7))-1,2));
    const emittedAt=new Intl.DateTimeFormat('pt-BR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(generatedReport.generatedAt||Date.now()));
    const summaryGroups=new Map();
    for(const entry of generatedReport.summary){const group=entry[0].startsWith('Fixos')?'Custos fixos':entry[0].startsWith('Cart')?'Cartões':entry[0].startsWith('Banco')?'Transações bancárias':'Investimentos';if(!summaryGroups.has(group))summaryGroups.set(group,[]);summaryGroups.get(group).push(entry);}
    const summaryHtml=[...summaryGroups].map(([group,entries])=>'<section class="summary-group"><h2>'+escape(group)+'</h2><div class="summary-cards">'+entries.map(([label,value])=>'<article class="summary"><span>'+escape(label)+'</span><strong>'+escape(value)+'</strong></article>').join('')+'</div></section>').join('');
    const colgroup='<colgroup><col style="width:12%"><col style="width:10%"><col style="width:20%"><col style="width:20%"><col style="width:13%"><col style="width:13%"><col style="width:12%"></colgroup>';
    const head='<tr>'+generatedReport.headers.map(label=>'<th>'+escape(label)+'</th>').join('')+'</tr>';
    const body=generatedReport.rows.map(row=>'<tr>'+row.map((value,index)=>'<td>'+escape(typeof value==='number'&&generatedReport.headers[index].startsWith('Valor')?money(value):value)+'</td>').join('')+'</tr>').join('');
    const styles='@page{size:A4 portrait;margin:13mm}*{box-sizing:border-box}body{margin:0;background:#f2f5f2;color:#243b32;font:10px/1.45 Arial,sans-serif}.sheet{max-width:210mm;min-height:270mm;margin:0 auto;padding:13mm;background:#fff}.brand-row{display:flex;align-items:center;gap:10px;padding-bottom:13px;border-bottom:1px solid #dfe7e1}.brand-mark{display:grid;place-items:center;width:38px;height:38px;border-radius:11px;background:linear-gradient(145deg,#28755f,#173c31);color:#fff}.brand-mark svg{width:26px;height:26px}.brand-text{font-size:16px;font-weight:700;color:#173c31}.brand-text strong{font-weight:800}.brand-caption{margin-left:auto;color:#708077;font-size:9px;letter-spacing:1px;text-transform:uppercase}.title-row{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin:23px 0 16px}.kicker{margin:0 0 5px;color:#63816e;font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase}h1{margin:0;color:#173c31;font-size:23px;line-height:1.18;letter-spacing:-.4px}.subtitle{margin:7px 0 0;color:#78867e;font-size:10px}.period-chip{flex:0 0 auto;padding:8px 11px;border:1px solid #dce8df;border-radius:9px;background:#f4f8f4;color:#345c47;font-size:10px;font-weight:700}.meta-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:17px 0 21px}.meta{padding:9px 11px;border:1px solid #e1e9e3;border-radius:8px}.meta span{display:block;margin-bottom:3px;color:#718078;font-size:8px;text-transform:uppercase;letter-spacing:.7px}.meta strong{display:block;color:#29483a;font-size:10px;overflow-wrap:anywhere}.section-label{margin:0 0 9px;color:#63816e;font-size:8px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase}.summary-list{display:grid;gap:13px;margin:0 0 22px}.summary-group{break-inside:avoid}.summary-group h2{margin:0 0 7px;color:#314c3d;font-size:11px}.summary-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.summary{display:grid;align-content:space-between;gap:7px;min-height:58px;padding:9px;border:1px solid #e1e9e3;border-radius:8px;background:#fbfcfb}.summary span{color:#718078;font-size:8px;line-height:1.35}.summary strong{color:#183f30;font-size:13px;line-height:1.2}.details-heading{display:flex;justify-content:space-between;align-items:end;margin:0 0 8px;padding-top:12px;border-top:2px solid #e4ebe5}.details-heading h2{margin:3px 0 0;color:#173c31;font-size:13px}.details-count{color:#718078;font-size:9px}table{width:100%;table-layout:fixed;border-collapse:collapse}th,td{padding:6px 5px;border-bottom:1px solid #e6ece7;text-align:left;vertical-align:top;overflow-wrap:anywhere;word-break:break-word;font-size:8px}th{background:#f1f5f1;color:#586a5f;font-size:7px;letter-spacing:.4px;text-transform:uppercase}tbody tr:nth-child(even){background:#fafbf9}tr{break-inside:avoid}footer{display:flex;justify-content:space-between;gap:12px;margin-top:20px;padding-top:9px;border-top:1px solid #e1e9e3;color:#819087;font-size:8px}@media screen{body{padding:24px 12px}.sheet{box-shadow:0 12px 42px #173c3115;border:1px solid #e4ebe5;border-radius:12px}}@media print{body{background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}.sheet{max-width:none;min-height:0;margin:0;padding:0;border:0;box-shadow:none}.summary-group,.meta{break-inside:avoid}}@media(max-width:700px){.sheet{padding:22px}.title-row{flex-direction:column}.brand-caption{display:none}.summary-cards{grid-template-columns:repeat(2,minmax(0,1fr))}.meta-grid{grid-template-columns:1fr}}';
    const brand='<header class="brand-row"><span class="brand-mark"><svg viewBox="0 0 40 40" aria-hidden="true"><path d="M8 28.5 16.2 20l5.1 5.2L32 13.5M25.8 13.5H32v6.2" fill="none" stroke="currentColor" stroke-width="3.3" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span class="brand-text">Minhas <strong>Finanças</strong></span><span class="brand-caption">Organização financeira pessoal</span></header>';
    const title='<section class="title-row"><div><p class="kicker">Relatório financeiro</p><h1>'+escape(generatedReport.selectedLabel||'Relatório mensal')+'</h1><p class="subtitle">Resumo e detalhamento das movimentações selecionadas.</p></div><span class="period-chip">'+escape(period)+'</span></section>';
    const meta='<section class="meta-grid"><div class="meta"><span>Período</span><strong>'+escape(period)+'</strong></div><div class="meta"><span>Emitido em</span><strong>'+escape(emittedAt)+'</strong></div><div class="meta"><span>Categorias</span><strong>'+escape(generatedReport.selectedLabel||'—')+'</strong></div></section>';
    const details='<section class="details"><div class="details-heading"><div><p class="kicker">Detalhamento</p><h2>Movimentações do período</h2></div><span class="details-count">'+generatedReport.rows.length+' '+(generatedReport.rows.length===1?'lançamento':'lançamentos')+'</span></div><table>'+colgroup+'<thead>'+head+'</thead><tbody>'+body+'</tbody></table></section>';
    const footer='<footer><span>Minhas Finanças · Relatório de uso pessoal</span><span>Documento gerado em '+escape(emittedAt)+'</span></footer>';
    const html='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(generatedReport.selectedLabel||'Relatório financeiro')+' · Minhas Finanças</title><style>'+styles+'</style></head><body><main class="sheet">'+brand+title+meta+'<section class="summary-list"><p class="section-label">Resumo financeiro</p>'+summaryHtml+'</section>'+details+footer+'</main></body></html>';
    popup.onload=()=>{popup.focus();popup.print();};
    popup.document.open();popup.document.write(html);popup.document.close();
  }

  function selectView(view){const transactionsView=view==='transactions';const fixed=view==='fixed';const cardView=view==='cards';const investmentsView=view==='investments';const reportsView=view==='reports';const connectionsView=view==='connections';$('#dashboardView').hidden=transactionsView||fixed||cardView||investmentsView||reportsView||connectionsView;$('#transactionsView').hidden=!transactionsView;$('#fixedView').hidden=!fixed;$('#cardsView').hidden=!cardView;$('#investmentsView').hidden=!investmentsView;$('#reportsView').hidden=!reportsView;$('#connectionsView').hidden=!connectionsView;for(const [id,active] of [['overviewTab',view==='overview'],['transactionsTab',transactionsView],['fixedTab',fixed],['cardsTab',cardView],['investmentsTab',investmentsView],['reportsTab',reportsView],['connectionsTab',connectionsView]]){const tab=document.getElementById(id);tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;}}
  $('#viewTabs').addEventListener('keydown',event=>{const ids=['overviewTab','transactionsTab','fixedTab','cardsTab','investmentsTab','reportsTab','connectionsTab'];const index=ids.indexOf(document.activeElement?.id);if(index<0)return;let next=index;if(event.key==='ArrowRight')next=(index+1)%ids.length;else if(event.key==='ArrowLeft')next=(index-1+ids.length)%ids.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=ids.length-1;else return;event.preventDefault();const tab=document.getElementById(ids[next]);tab.focus();tab.click();});
  $('#overviewTab').addEventListener('click',()=>selectView('overview'));$('#transactionsTab').addEventListener('click',()=>selectView('transactions'));$('#fixedTab').addEventListener('click',()=>selectView('fixed'));$('#cardsTab').addEventListener('click',()=>selectView('cards'));$('#investmentsTab').addEventListener('click',()=>selectView('investments'));$('#reportsTab').addEventListener('click',()=>selectView('reports'));$('#connectionsTab').addEventListener('click',()=>{selectView('connections');loadBrokerageConnectors();loadConnectedBrokerages();if(sessionInfo.isAdmin)loadMyPluggyStatus();});
  $('#importCardStatement').addEventListener('click',()=>{if(!cards.length){showToast('Cadastre um cartão antes de importar a fatura.');return;}if(!$('#statementCardId').value){showToast('Selecione o cartão que recebeu esta fatura.');return;}$('#cardStatementFile').click();});
  $('#cardStatementFile').addEventListener('change',async(event)=>{const file=event.target.files?.[0];if(!file)return;try{await importCardStatement(file);}catch(error){showToast(error.message||'Não foi possível importar esta fatura.');}finally{event.target.value='';}});
  $('#overviewBankSelect').addEventListener('change',event=>{overviewBankAccountId=event.currentTarget.value;renderOverviewBankSummary();});
  $('#transactionsMonthFilter').value=monthKey(today);$('#transactionsMonthFilter').addEventListener('change',event=>{const [year,month]=event.currentTarget.value.split('-').map(Number);monthOffset=(year-today.getFullYear())*12+(month-1-today.getMonth());render();});$('#bankAccountSelect').addEventListener('change',event=>{selectedBankAccountId=event.currentTarget.value;localStorage.setItem(BANK_SELECTED_ACCOUNT_KEY,selectedBankAccountId);renderAllTransactions();});$('#addBankAccount').addEventListener('click',()=>{const name=prompt('Informe o nome do banco (ex.: Bradesco, Itaú, Mercado Pago):');if(!name||!name.trim())return;const normalized=name.trim();if(bankAccounts.some(item=>String(item.bankName||item.name).toLocaleLowerCase('pt-BR')===normalized.toLocaleLowerCase('pt-BR')&&!item.excluded)){showToast('Já existe uma conta com esse banco.');return;}const id=crypto.randomUUID?crypto.randomUUID():`bank-${Date.now()}-${Math.random()}`;bankAccounts.push({id,name:normalized,bankName:normalized});selectedBankAccountId=id;localStorage.setItem(BANK_ACCOUNTS_KEY,JSON.stringify(bankAccounts));localStorage.setItem(BANK_SELECTED_ACCOUNT_KEY,id);renderAllTransactions();showToast('Conta bancária adicionada. Importe o extrato dela.');});
  $('#deleteBankAccount').addEventListener('click',async()=>{const account=bankAccounts.find(item=>!item.excluded&&String(item.id)===String(selectedBankAccountId));if(!account)return;const belongsToBank= item=>!item.cardId&&item.paymentMethod!=='cartao'&&transactionBankAccountId(item)===String(account.id);const linked=transactions.filter(belongsToBank);if(!confirm(`Excluir ${bankAccountOptionLabel(account)} e remover ${linked.length} transação(ões) vinculada(s)?`))return;const excluded=(()=>{try{const value=JSON.parse(localStorage.getItem(BANK_EXCLUDED_ACCOUNTS_KEY)||'[]');return Array.isArray(value)?value:[];}catch{return[];}})();if(account.source==='MeuPluggy'&&account.pluggyAccountId&&!excluded.includes(String(account.pluggyAccountId)))excluded.push(String(account.pluggyAccountId));bankAccounts=bankAccounts.filter(item=>String(item.id)!==String(account.id));transactions=transactions.filter(item=>!belongsToBank(item));for(const key of Object.keys(bankBalanceOverrides))if(key.startsWith(`${account.id}::`))delete bankBalanceOverrides[key];selectedBankAccountId=bankAccounts.find(item=>!item.excluded)?.id||'';localStorage.setItem(BANK_ACCOUNTS_KEY,JSON.stringify(bankAccounts));localStorage.setItem(BANK_EXCLUDED_ACCOUNTS_KEY,JSON.stringify(excluded));localStorage.setItem(TX_KEY,JSON.stringify(transactions));localStorage.setItem(BANK_BALANCE_KEY,JSON.stringify(bankBalanceOverrides));localStorage.setItem(BANK_SELECTED_ACCOUNT_KEY,String(selectedBankAccountId));render();renderAllTransactions();showToast('Conta excluída da lista e transações vinculadas removidas.');});
  $('#fixedCostMonthFilter').value=monthKey(today);$('#fixedCostMonthFilter').addEventListener('change',renderFixedCosts);$('#fixedPaidYear').addEventListener('change',renderFixedAnnualChart);
  $('#cardMonthFilter').value=monthKey(today);$('#cardMonthFilter').addEventListener('change',renderCardPurchases);
  $('#investmentMonthFilter').value=monthKey(today);$('#investmentMonthFilter').addEventListener('change',renderInvestments);$('#investmentYear').addEventListener('change',renderInvestmentAnnualChart);$('#reportMonth').value=monthKey(today);$('#generateReport').addEventListener('click',renderReport);$('#reportFixed').addEventListener('change',()=>{$('#downloadReport').hidden=true;$('#downloadReportPdf').hidden=true;});$('#reportCards').addEventListener('change',()=>{$('#downloadReport').hidden=true;$('#downloadReportPdf').hidden=true;});$('#reportInvestments').addEventListener('change',()=>{$('#downloadReport').hidden=true;$('#downloadReportPdf').hidden=true;});$('#reportBanking').addEventListener('change',()=>{$('#downloadReport').hidden=true;$('#downloadReportPdf').hidden=true;});$('#reportMonth').addEventListener('change',()=>{$('#downloadReport').hidden=true;$('#downloadReportPdf').hidden=true;});$('#downloadReport').addEventListener('click',downloadReportCsv);$('#downloadReportPdf').addEventListener('click',downloadReportPdf);
  function getInvestmentHoldings(excludeId=null){const holdings=new Map();for(const item of investments){if(String(item.id)===String(excludeId)||item.kind==='Criptoativos')continue;const key=JSON.stringify([item.kind,item.name]);const position=holdings.get(key)||{key,kind:item.kind,name:item.name,balance:0};position.balance+=((item.movement||'contribution')==='withdrawal'?-1:1)*Number(item.amount||0);holdings.set(key,position);}return [...holdings.values()].filter(item=>item.balance>0.005).sort((a,b)=>a.name.localeCompare(b.name));}
  async function renderInvestmentAllocation(){
    const generation=++investmentAllocationGeneration;const content=$('#investmentAllocationContent');const legend=$('#investmentAllocationLegend');const chart=$('#investmentAllocationChart');const empty=$('#investmentAllocationEmpty');
    const positions=getInvestmentHoldings().map(item=>({name:item.name,kind:item.kind,value:item.balance}));const cryptoCost=new Map();for(const item of investments){if(item.kind!=='Criptoativos')continue;const symbol=canonicalCryptoSymbol(item.symbol);if(!symbol)continue;const sign=(item.movement||'contribution')==='withdrawal'?-1:1;cryptoCost.set(symbol,(cryptoCost.get(symbol)||0)+sign*Number(item.amount||0));}
    const cryptoPositions=getCryptoPositions();const quotes=await Promise.all(cryptoPositions.map(async position=>{try{const quote=await getCryptoPriceBRL(position.symbol);return{position,value:Number(position.quantity)*quote.price,quoted:true};}catch{return{position,value:cryptoCost.get(position.symbol)||0,quoted:false};}}));
    if(generation!==investmentAllocationGeneration)return;for(const item of quotes){if(item.value>0.005)positions.push({name:item.position.symbol,kind:item.quoted?'Criptoativos · cotação atual':'Criptoativos · último valor investido',value:item.value});}
    const total=positions.reduce((sum,item)=>sum+item.value,0);legend.replaceChildren();if(total<=0){content.hidden=true;empty.hidden=false;return;}content.hidden=false;empty.hidden=true;$('#investmentAllocationTotal').textContent=money(total);
    positions.sort((a,b)=>b.value-a.value);const palette=['#245b48','#d17d52','#527da8','#9a6ab0','#c39b35','#3d9b9a','#b75b68','#78845a','#6b7fa8','#ba7554'];let angle=0;const segments=positions.map((item,index)=>{const start=angle;angle+=item.value/total*360;return`${palette[index%palette.length]} ${start}deg ${angle}deg`;});chart.style.background=`conic-gradient(${segments.join(',')})`;chart.setAttribute('aria-label',`Carteira de ${money(total)} distribuída entre ${positions.length} investimentos`);
    positions.forEach((item,index)=>{const row=document.createElement('div');row.className='investment-allocation-row';const left=document.createElement('div');left.className='investment-allocation-name';const swatch=document.createElement('i');swatch.className='investment-allocation-swatch';swatch.style.backgroundColor=palette[index%palette.length];const labels=document.createElement('div');labels.className='investment-allocation-labels';const name=document.createElement('strong');name.textContent=item.name;const kind=document.createElement('small');kind.textContent=item.kind;labels.append(name,kind);left.append(swatch,labels);const values=document.createElement('div');values.className='investment-allocation-values';const amount=document.createElement('strong');amount.textContent=money(item.value);const percent=document.createElement('small');percent.textContent=`${(item.value/total*100).toLocaleString('pt-BR',{maximumFractionDigits:1})}%`;values.append(amount,percent);row.append(left,values);legend.append(row);});
  }
  function populateInvestmentTargets(selectedKey=''){const form=$('#investmentForm');const select=form.elements.targetInvestment;const editItem=investments.find(item=>String(item.id)===String(editingInvestmentId));const excludeId=editItem&&(editItem.movement||'contribution')==='withdrawal'?editingInvestmentId:null;const currentKey=selectedKey||select.value||(editItem?JSON.stringify([editItem.kind,editItem.name]):'');const holdings=getInvestmentHoldings(excludeId);select.replaceChildren(new Option(holdings.length?'Selecione de onde sairá o aporte':'Nenhum investimento com saldo disponível',''));for(const item of holdings){const option=new Option(`${item.name} · ${item.kind} · saldo ${money(item.balance)}`,item.key);select.add(option);}if(holdings.some(item=>item.key===currentKey))select.value=currentKey;}
  function updateInvestmentFormFields(){const form=$('#investmentForm');const isCrypto=form.elements.kind.value==='Criptoativos';if(isCrypto)form.elements.movement.value='contribution';form.elements.movement.disabled=isCrypto;$('#investmentMovementField').hidden=isCrypto;const withdrawal=!isCrypto&&form.elements.movement.value==='withdrawal';$('#investmentTargetField').hidden=!withdrawal;$('#investmentNameField').hidden=withdrawal;$('#investmentKindField').hidden=withdrawal;form.elements.name.required=!withdrawal;form.elements.targetInvestment.required=withdrawal;form.elements.symbol.required=isCrypto;form.elements.quantity.required=isCrypto;$('#cryptoFields').hidden=!isCrypto;if(withdrawal)populateInvestmentTargets();const title=withdrawal?'Registrar saída':editingInvestmentId!==null?'Editar movimentação':'Registrar aporte';$('#investmentDialogEyebrow').textContent=editingInvestmentId!==null?'EDITAR MOVIMENTAÇÃO':withdrawal?'SAÍDA DE INVESTIMENTO':'NOVO APORTE';$('#investmentDialogTitle').textContent=title;$('#saveInvestment').textContent=withdrawal?'Salvar saída':editingInvestmentId!==null?'Salvar alterações':'Salvar aporte';}
  $('#addInvestment').addEventListener('click',()=>{editingInvestmentId=null;const form=$('#investmentForm');form.reset();form.elements.movement.value='contribution';form.elements.date.value=dateISO(today);updateInvestmentFormFields();$('#investmentDialog').showModal();});
  $('#addInvestmentExit').addEventListener('click',()=>{editingInvestmentId=null;const form=$('#investmentForm');form.reset();form.elements.movement.value='withdrawal';form.elements.date.value=dateISO(today);updateInvestmentFormFields();$('#investmentDialog').showModal();});
  $('#closeInvestmentDialog').addEventListener('click',()=>$('#investmentDialog').close());
  $('#investmentForm').elements.kind.addEventListener('change',updateInvestmentFormFields);
  $('#investmentForm').elements.movement.addEventListener('change',updateInvestmentFormFields);
  $('#investmentForm').addEventListener('submit',(event)=>{event.preventDefault();const fd=new FormData(event.currentTarget);const amount=Number(fd.get('amount'));if(!Number.isFinite(amount)||amount<=0){showToast('Informe um valor válido.');return;}const isCrypto=fd.get('kind')==='Criptoativos';const movement=isCrypto?'contribution':fd.get('movement');let name=String(fd.get('name')||'').trim();let kind=String(fd.get('kind')||'');if(movement==='withdrawal'){const key=String(fd.get('targetInvestment')||'');const holding=getInvestmentHoldings((investments.find(item=>String(item.id)===String(editingInvestmentId))?.movement||'contribution')==='withdrawal'?editingInvestmentId:null).find(item=>item.key===key);if(!holding){showToast('Selecione um investimento disponível na carteira.');return;}if(amount>holding.balance+0.005){showToast(`O saldo disponível para ${holding.name} é ${money(holding.balance)}.`);return;}name=holding.name;kind=holding.kind;}const quantity=Number(fd.get('quantity'));const symbol=String(fd.get('symbol')||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');if(isCrypto&&(!symbol||!Number.isFinite(quantity)||quantity<=0)){showToast('Informe o ticker e a quantidade de criptoativos.');return;}const values={name,kind,movement,amount,date:fd.get('date'),symbol:isCrypto?symbol:null,quantity:isCrypto?quantity:null};const wasEditing=editingInvestmentId!==null;if(wasEditing){const index=investments.findIndex(item=>String(item.id)===String(editingInvestmentId));if(index>=0)investments[index]={...investments[index],...values};}else investments.push({id:crypto.randomUUID?crypto.randomUUID():`investment-${Date.now()}-${Math.random()}`,...values});localStorage.setItem(INVESTMENT_KEY,JSON.stringify(investments));editingInvestmentId=null;event.currentTarget.reset();updateInvestmentFormFields();$('#investmentDialog').close();render();showToast(movement==='withdrawal'?'Saída registrada.':wasEditing?'Aporte atualizado.':'Aporte registrado.');});
  function openInvestmentEdit(id){const item=investments.find(value=>String(value.id)===String(id));if(!item)return;editingInvestmentId=id;const form=$('#investmentForm');form.elements.name.value=item.name;form.elements.kind.value=item.kind;form.elements.movement.value=item.movement||'contribution';form.elements.targetInvestment.value='';form.elements.amount.value=item.amount;form.elements.date.value=item.date;form.elements.symbol.value=item.symbol||'';form.elements.quantity.value=item.quantity||'';updateInvestmentFormFields();$('#investmentDialog').showModal();}
  function deleteInvestment(id){const item=investments.find(value=>String(value.id)===String(id));if(!item||!confirm(`Apagar esta movimentação de investimento (“${item.name}”)?`))return;investments=investments.filter(value=>String(value.id)!==String(id));localStorage.setItem(INVESTMENT_KEY,JSON.stringify(investments));render();showToast('Movimentação apagada.');}
  const cryptoExchangeOptions={
    binance:{name:'Binance',fields:{apiKey:'Chave API',apiSecret:'Segredo API'},url:'https://www.binance.com/en/my/settings/api-management'},
    mercadobitcoin:{name:'Mercado Bitcoin',fields:{apiKey:'ID da chave API',apiSecret:'Segredo da chave'},url:'https://www.mercadobitcoin.com.br/api'},
    coinbase:{name:'Coinbase',fields:{apiKey:'Nome da chave CDP',privateKey:'Chave privada PEM'},url:'https://portal.cdp.coinbase.com/access/api'},
    okx:{name:'OKX',fields:{apiKey:'Chave API',apiSecret:'Segredo API',passphrase:'Frase de acesso da chave'},url:'https://www.okx.com/account/my-api'},
    bybit:{name:'Bybit',fields:{apiKey:'Chave API',apiSecret:'Segredo API'},url:'https://www.bybit.com/app/user/api-management'},
    kraken:{name:'Kraken',fields:{apiKey:'Chave API',apiSecret:'Segredo API'},url:'https://www.kraken.com/u/security/api'}
  };
  if(syncedBinance?.selectedExchange&&cryptoExchangeOptions[syncedBinance.selectedExchange])$('#cryptoExchangeSelect').value=syncedBinance.selectedExchange;
  function selectedCryptoExchange(){return $('#cryptoExchangeSelect').value||'binance';}
  function selectedCryptoSnapshot(){const provider=selectedCryptoExchange();return syncedBinance?.exchanges?.[provider]||(syncedBinance?.exchange===provider?syncedBinance:provider==='binance'&&!syncedBinance?.exchange?syncedBinance:null);}
  function updateCryptoExchangeForm(){
    const provider=selectedCryptoExchange(),spec=cryptoExchangeOptions[provider];
    $('#cryptoAccountTitle').textContent='Conta '+spec.name;
    $('#syncBinance').textContent='Sincronizar '+spec.name;
    $('#cryptoExchangeInstructions').href=spec.url;
    $('#cryptoExchangeInstructions').textContent='Como criar chave somente leitura na '+spec.name;
    for(const field of document.querySelectorAll('[data-crypto-field]')){const name=field.dataset.cryptoField;const label=spec.fields[name];field.hidden=!label;const input=field.querySelector('input,textarea');input.required=Boolean(label);input.value='';if(label)field.querySelector('.crypto-field-name').textContent=label;}
    loadCryptoCredentialStatus();renderCryptoPortfolio();
  }
  $('#cryptoExchangeSelect').addEventListener('change',()=>{if(!syncedBinance)syncedBinance={balances:[],exchanges:{}};syncedBinance.selectedExchange=selectedCryptoExchange();localStorage.setItem(BINANCE_BALANCES_KEY,JSON.stringify(syncedBinance));updateCryptoExchangeForm();});
  $('#refreshCryptoQuotes').addEventListener('click',async()=>{await Promise.all([updateCryptoQuoteRows(getCryptoPositions(),true),updateCryptoQuoteRows(investments.filter(item=>item.kind==='Criptoativos'),true,false)]);await renderInvestmentAllocation();});
  $('#syncBinance').addEventListener('click',syncCryptoExchangeAccount);
  $('#cardInvoiceYear').addEventListener('change',renderCardInvoiceChart);
  $('#binanceCredentialForm').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget,provider=selectedCryptoExchange(),spec=cryptoExchangeOptions[provider];
    const button=form.querySelector('button[type=submit]'),status=$('#binanceCredentialStatus');const credentials=Object.fromEntries(new FormData(form));
    button.disabled=true;status.textContent='Criptografando e salvando as credenciais nesta conta…';
    try{const response=await fetch('/api/crypto/'+provider+'/credentials',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials),cache:'no-store'});const result=await response.json();if(response.status===401){location.reload();return;}if(!response.ok)throw new Error(result.error||'Não foi possível salvar as credenciais.');form.reset();$('#removeBinanceCredentials').hidden=false;status.textContent='Credenciais da '+spec.name+' protegidas para esta conta. Agora você pode sincronizar.';showToast('Credenciais da '+spec.name+' salvas.');}
    catch(error){status.textContent=error.message;showToast(error.message);}finally{button.disabled=false;}
  });
  $('#removeBinanceCredentials').addEventListener('click',async()=>{
    const spec=cryptoExchangeOptions[selectedCryptoExchange()];if(!confirm('Remover as credenciais da '+spec.name+' desta conta?'))return;
    const button=$('#removeBinanceCredentials');button.disabled=true;
    try{const response=await fetch('/api/crypto/'+selectedCryptoExchange()+'/credentials',{method:'DELETE',cache:'no-store'});const result=await response.json();if(response.status===401){location.reload();return;}if(!response.ok)throw new Error(result.error||'Não foi possível remover as credenciais.');button.hidden=true;$('#binanceCredentialStatus').textContent='Credenciais removidas desta conta.';showToast('Credenciais removidas.');}
    catch(error){$('#binanceCredentialStatus').textContent=error.message;showToast(error.message);}finally{button.disabled=false;}
  });
  async function loadCryptoCredentialStatus(){
    const provider=selectedCryptoExchange(),spec=cryptoExchangeOptions[provider];
    try{const response=await fetch('/api/crypto/'+provider+'/credentials',{cache:'no-store'});const data=await response.json();if(response.status===401){location.reload();return;}if(!response.ok)throw new Error(data.error||'Não foi possível consultar as credenciais.');
      $('#removeBinanceCredentials').hidden=!data.configured;$('#binanceCredentialStatus').textContent=data.configured?'Chave somente leitura protegida para '+spec.name+'.':'As credenciais ficam vinculadas somente a esta conta.';
      $('#binanceConnectionState').textContent=selectedCryptoSnapshot()?.updatedAt?'Sincronizada':'Não sincronizada';
      $('#binanceConnectionMessage').textContent=data.configured?'Sincronize para atualizar os saldos da '+spec.name+'.':'Cadastre uma chave com permissão somente leitura para acompanhar sua carteira.';
    }catch(error){$('#binanceCredentialStatus').textContent=error.message;}
  }
  updateCryptoExchangeForm();
  $('#logout').addEventListener('click',async()=>{try{const response=await fetch('/api/logout',{method:'POST'});if(response.ok)location.reload();else showToast('Não foi possível encerrar a sessão.');}catch{showToast('Abra o painel pelo servidor local para encerrar a sessão.');}});
  $('#reloadBrokerageConnectors').addEventListener('click',loadBrokerageConnectors);
  $('#brokerageConnectorSelect').addEventListener('change',()=>{$('#connectBrokerage').disabled=!$('#brokerageConnectorSelect').value;});
  $('#connectBrokerage').addEventListener('click',connectSelectedBrokerage);
  if(sessionInfo.isAdmin){
    $('#myPluggyAdminPanel').hidden=false;
    $('#connectMyPluggy').addEventListener('click',connectMyPluggy);
    $('#syncMyPluggy').addEventListener('click',syncMyPluggy);
  }
  async function loadMyPluggyStatus(){
    if(!sessionInfo.isAdmin)return;
    const status=$('#myPluggyStatus');
    try{
      const response=await fetch('/api/mypluggy/status',{cache:'no-store'}),data=await response.json();
      if(response.status===401){location.reload();return;}
      if(!response.ok)throw new Error(data.error||'Não foi possível verificar MeuPluggy.');
      status.textContent=data.message||'';
      $('#connectMyPluggy').textContent=data.connected?'Adicionar outro ItemId':'Vincular ItemId';
      $('#syncMyPluggy').hidden=!data.connected;
      $('#syncMyPluggy').disabled=false;
      const linkedItems=$('#myPluggyLinkedItems');linkedItems.replaceChildren();
      for(const item of data.items||[]){
        const row=document.createElement('div');row.className='brokerage-position-row';
        const label=document.createElement('span');label.textContent=(item.accountNames||[]).join(', ')||'Conexão MeuPluggy';
        const id=document.createElement('strong');id.textContent=item.itemId;
        row.append(label,id);linkedItems.append(row);
      }
      linkedItems.hidden=!(data.items||[]).length;
    }catch(error){status.textContent=error.message;}
  }
  async function connectMyPluggy(){
    const button=$('#connectMyPluggy'),status=$('#myPluggyStatus'),itemId=$('#myPluggyItemId').value.trim();
    if(!itemId){status.textContent='Informe o itemId da conexão MeuPluggy criada no painel Pluggy.';$('#myPluggyItemId').focus();return;}
    button.disabled=true;status.textContent='Validando a conexão pessoal na Pluggy…';
    try{
      const response=await fetch('/api/mypluggy/item',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({itemId}),cache:'no-store'});
      const data=await response.json().catch(()=>({}));
      if(response.status===401){location.reload();return;}
      if(!response.ok)throw new Error(data.error||'Não foi possível vincular a conexão MeuPluggy.');
      $('#myPluggyItemId').value='';
      status.textContent='ItemId MeuPluggy vinculado. Importando as conexões…';
      await loadMyPluggyStatus();
      await syncMyPluggy();
    }catch(error){status.textContent=error.message;showToast(error.message);}
    finally{button.disabled=false;}
  }
  async function syncMyPluggy(){
    if(!sessionInfo.isAdmin)return;
    const button=$('#syncMyPluggy'),status=$('#myPluggyStatus'),accountsList=$('#myPluggyAccounts');
    button.disabled=true;status.textContent='Sincronizando contas e transações do MeuPluggy…';
    try{
      const response=await fetch('/api/mypluggy/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',cache:'no-store'}),data=await response.json();
      if(response.status===401){location.reload();return;}
      if(!response.ok)throw new Error(data.error||'Não foi possível sincronizar MeuPluggy.');
      const importedAccounts=[];
      const importedCards=Array.isArray(data.cards)?data.cards:[];
      const importedCardAccountIds=new Set(importedCards.map(card=>String(card.pluggyAccountId||'')).filter(Boolean));
      bankAccounts=bankAccounts.filter(item=>!(item.source==='MeuPluggy'&&importedCardAccountIds.has(String(item.pluggyAccountId||'').replace(/^pluggy-/,''))));
      transactions=transactions.filter(item=>!(importedCardAccountIds.has(String(item.accountId||''))&&String(item.externalId||'').startsWith('mypluggy:')&&!item.cardId));
      for(const card of importedCards){
        const existing=cards.find(item=>String(item.pluggyAccountId||'')===String(card.pluggyAccountId||'')||String(item.id)===String(card.id));
        if(existing)Object.assign(existing,card);
        else cards.push(card);
      }
      if(importedCards.length)saveCards();
      const locallyExcludedPluggy=(()=>{try{return new Set(JSON.parse(localStorage.getItem(BANK_EXCLUDED_ACCOUNTS_KEY)||'[]').map(String));}catch{return new Set();}})();
      for(const account of data.accounts||[]){if(locallyExcludedPluggy.has(String(account.id)))continue;
        const accountId='pluggy-'+String(account.id);
        let saved=bankAccounts.find(item=>String(item.id)===accountId);
        if(!saved){saved={id:accountId,name:String(account.name||'Conta')+' · MeuPluggy',source:'MeuPluggy',pluggyAccountId:String(account.id)};bankAccounts.push(saved);}
        saved.name=String(account.name||'Conta')+' · MeuPluggy';saved.bankName=String(account.bankName||account.name||'Banco');saved.accountNumber=String(account.accountNumber||'');saved.accountType=String(account.accountType||account.type||'');saved.source='MeuPluggy';saved.pluggyAccountId=String(account.id);saved.balance=Number(account.balance)||0;saved.currencyCode=String(account.currencyCode||'BRL');
        importedAccounts.push(saved);
      }
      if(importedAccounts.length){
        localStorage.setItem(BANK_ACCOUNTS_KEY,JSON.stringify(bankAccounts));
        selectedBankAccountId=String(importedAccounts[0].id);
        localStorage.setItem(BANK_SELECTED_ACCOUNT_KEY,selectedBankAccountId);
        const newestDate=(data.transactions||[]).map(movement=>String(movement.date||'').slice(0,10)).filter(date=>/^\d{4}-\d{2}-\d{2}$/.test(date)).sort().at(-1);
        if(newestDate)$('#transactionsMonthFilter').value=newestDate.slice(0,7);
      }
      localStorage.setItem(BANK_ACCOUNTS_KEY,JSON.stringify(bankAccounts));
      let added=0,updated=0;
      for(const movement of data.transactions||[]){
        const externalId=String(movement.externalId||'');
        const accountId='pluggy-'+String(movement.accountId||'');
        const normalized={...movement,id:String(movement.id||externalId),externalId,createdAt:Date.now()};if(!movement.cardId)normalized.bankAccountId=accountId;
        const existing=transactions.find(item=>externalId&&item.externalId===externalId);
        if(existing){const id=existing.id;Object.assign(existing,normalized,{id,createdAt:existing.createdAt||normalized.createdAt});updated++;}
        else{transactions.push(normalized);added++;}
      }
      localStorage.setItem(TX_KEY,JSON.stringify(transactions));
      render();
      renderAllTransactions();
      accountsList.replaceChildren();
      for(const account of importedAccounts){
        const accountBlock=document.createElement('section');accountBlock.className='mypluggy-account-block';
        const header=document.createElement('div');header.className='mypluggy-account-heading';
        const name=document.createElement('strong');name.textContent=account.name;
        const balance=document.createElement('span');balance.textContent=money(account.balance);
        header.append(name,balance);accountBlock.append(header);
        const accountTransactions=transactions.filter(transaction=>transaction.paymentMethod==='openfinance'&&transaction.bankAccountId===String(account.id)).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
        if(accountTransactions.length){
          const tableWrap=document.createElement('div');tableWrap.className='mypluggy-transaction-wrap';
          const table=document.createElement('table');table.className='mypluggy-transaction-table';
          const thead=document.createElement('thead'),headRow=document.createElement('tr');
          for(const label of ['Data','Descrição','Categoria','Valor']){const th=document.createElement('th');th.scope='col';th.textContent=label;headRow.append(th);}
          thead.append(headRow);table.append(thead);
          const tbody=document.createElement('tbody');
          for(const transaction of accountTransactions){
            const row=document.createElement('tr');
            const date=document.createElement('td');date.textContent=new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'}).format(parseDate(transaction.date));
            const description=document.createElement('td');description.textContent=transaction.description||'Transação';
            const category=document.createElement('td');category.textContent=transaction.category||'Sem categoria';
            const amount=document.createElement('td');amount.className=transaction.type==='income'?'income':'expense';amount.textContent=`${transaction.type==='income'?'+':'−'} ${money(transaction.amount)}`;
            row.append(date,description,category,amount);tbody.append(row);
          }
          table.append(tbody);tableWrap.append(table);accountBlock.append(tableWrap);
        }else{
          const empty=document.createElement('p');empty.className='mypluggy-transactions-empty';empty.textContent='Nenhum lançamento retornado para esta conta.';accountBlock.append(empty);
        }
        accountsList.append(accountBlock);
      }
      accountsList.hidden=!importedAccounts.length;
      await loadMyPluggyStatus();
      const failedCount=Array.isArray(data.failedItems)?data.failedItems.length:0;
      status.textContent=`Sincronização concluída · ${data.itemCount||1} conexão(ões), ${importedAccounts.length} conta(s) bancária(s), ${importedCards.length} cartão(ões), ${added} nova(s) e ${updated} atualizada(s)${failedCount?` · ${failedCount} conexão(ões) com erro`:''}.`;
      showToast('MeuPluggy sincronizado: extratos em Transações bancárias e compras em Cartões.');
    }catch(error){status.textContent=error.message;showToast(error.message);}
    finally{button.disabled=false;}
  }
  async function loadBrokerageConnectors(){
    const select=$('#brokerageConnectorSelect'),status=$('#brokerageConnectorStatus'),button=$('#connectBrokerage'),reload=$('#reloadBrokerageConnectors');
    reload.disabled=true;button.disabled=true;status.textContent='Buscando corretoras disponíveis na Pluggy…';select.replaceChildren(new Option('Carregando corretoras…',''));
    try{
      const response=await fetch('/api/brokerages/connectors',{cache:'no-store'});const data=await response.json();
      if(response.status===401){location.reload();return;}if(!response.ok)throw new Error(data.error||'Não foi possível carregar as corretoras.');
      const connectors=Array.isArray(data.connectors)?data.connectors:[];select.replaceChildren(new Option(connectors.length?'Selecione uma corretora':'Nenhuma corretora disponível',''));
      for(const connector of connectors){const suffix=connector.sandbox?' · Sandbox':'';const option=new Option(`${connector.name}${suffix}`,String(connector.id));option.dataset.name=connector.name;option.dataset.sandbox=String(connector.sandbox);option.dataset.type=connector.type||'INVESTMENT';if(connector.status==='OFFLINE')option.disabled=true;select.add(option);}
      status.textContent=connectors.length?'Lista carregada. Selecione uma instituição com dados de investimento e autorize o acesso no widget Pluggy.':'A Pluggy não retornou conectores brasileiros com dados de investimento. Confira se a aplicação Pluggy tem conectores habilitados.';
      button.disabled=!select.value;
    }catch(error){select.replaceChildren(new Option('Lista indisponível',''));status.textContent=error.message;}
    finally{reload.disabled=false;}
  }
  async function loadConnectedBrokerages(){
    const container=$('#brokerageConnectedList');container.replaceChildren();
    try{const response=await fetch('/api/brokerages',{cache:'no-store'});const data=await response.json();if(response.status===401){location.reload();return;}if(!response.ok)throw new Error(data.error||'Não foi possível carregar as corretoras conectadas.');
      const entries=Array.isArray(data.brokerages)?data.brokerages:[];if(!entries.length){const empty=document.createElement('p');empty.className='brokerage-empty';empty.textContent='Nenhuma corretora conectada ainda.';container.append(empty);return;}
      for(const entry of entries){const card=document.createElement('article');card.className='brokerage-connected-card';card.dataset.itemId=entry.itemId;const header=document.createElement('div');header.className='brokerage-connected-heading';const title=document.createElement('strong');title.textContent=entry.connectorName;const sync=document.createElement('button');sync.type='button';sync.className='row-action';sync.textContent='Sincronizar';sync.addEventListener('click',()=>syncBrokerage(entry.itemId,card,sync));header.append(title,sync);const date=document.createElement('small');date.textContent=entry.syncedAt?`Atualizada em ${new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(entry.syncedAt))}`:'Ainda não sincronizada';const positions=document.createElement('div');positions.className='brokerage-position-list';renderBrokeragePositions(positions,entry.investments||[]);card.append(header,date,positions);container.append(card);}
    }catch(error){const message=document.createElement('p');message.className='brokerage-empty';message.textContent=error.message;container.append(message);}
  }
  function renderBrokeragePositions(container,positions){
    container.replaceChildren();if(!positions.length){const empty=document.createElement('small');empty.textContent='Nenhuma posição de investimento retornada. Sincronize para atualizar.';container.append(empty);return;}
    for(const position of positions){const row=document.createElement('div');row.className='brokerage-position-row';const name=document.createElement('span');name.textContent=[position.name,position.type,position.subtype].filter(Boolean).join(' · ');const value=document.createElement('strong');value.textContent=money(position.balance);row.append(name,value);container.append(row);}
  }
  async function connectSelectedBrokerage(){
    const select=$('#brokerageConnectorSelect'),connectorId=Number(select.value),connectorName=select.selectedOptions[0]?.dataset.name||'corretora',connectorType=select.selectedOptions[0]?.dataset.type||'INVESTMENT';const button=$('#connectBrokerage'),status=$('#brokerageConnectorStatus');if(!Number.isInteger(connectorId)||connectorId<=0)return;
    button.disabled=true;button.textContent='Preparando conexão…';status.textContent=`Preparando conexão segura com ${connectorName}…`;
    try{const tokenResponse=await fetch('/api/connect-token',{method:'POST',cache:'no-store'});const token=await tokenResponse.json();if(tokenResponse.status===401){location.reload();return;}if(!tokenResponse.ok)throw new Error(token.error||'Não foi possível preparar a conexão.');if(typeof window.PluggyConnect!=='function')throw new Error('O componente Pluggy Connect não carregou.');
      const widget=new window.PluggyConnect({connectToken:token.accessToken,includeSandbox:true,connectorTypes:[connectorType],connectorIds:[connectorId],selectedConnectorId:connectorId,countries:['BR'],onSuccess:async result=>{const itemId=result?.item?.id||result?.id;if(!itemId){status.textContent='A Pluggy não retornou o identificador da conexão.';return;}try{const response=await fetch('/api/brokerages/item',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({itemId})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Não foi possível salvar a corretora.');status.textContent=`${data.brokerage.connectorName} conectada. Sincronizando posição…`;showToast(`${data.brokerage.connectorName} conectada.`);await loadConnectedBrokerages();const card=[...$('#brokerageConnectedList').children].find(node=>node.dataset.itemId===itemId);if(card){const sync=card.querySelector('button');await syncBrokerage(itemId,card,sync);}}catch(error){status.textContent=error.message;showToast(error.message);}},onError:error=>{const message=error?.message||'Não foi possível concluir a conexão com a corretora.';status.textContent=message;showToast(message);}});widget.init();
    }catch(error){status.textContent=error.message;showToast(error.message);}finally{button.disabled=!select.value;button.textContent='Acessar Pluggy Connect';}
  }
  async function syncBrokerage(itemId,card,button){
    const original=button.textContent;button.disabled=true;button.textContent='Sincronizando…';
    try{const response=await fetch('/api/brokerages/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({itemId})});const data=await response.json();if(response.status===401){location.reload();return;}if(!response.ok)throw new Error(data.error||'Não foi possível sincronizar a carteira.');const date=card.querySelector('small');date.textContent=`Atualizada em ${new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(data.syncedAt))}`;renderBrokeragePositions(card.querySelector('.brokerage-position-list'),data.investments||[]);$('#brokerageConnectorStatus').textContent=`${data.connectorName}: ${(data.investments||[]).length} posições sincronizadas.`;showToast(`${data.connectorName} sincronizada.`);}catch(error){$('#brokerageConnectorStatus').textContent=error.message;showToast(error.message);}finally{button.disabled=false;button.textContent=original;}
  }
  async function syncCryptoExchangeAccount(){
    const provider=selectedCryptoExchange(),spec=cryptoExchangeOptions[provider];
    const button=$('#syncBinance'),status=$('#binanceConnectionState'),message=$('#binanceConnectionMessage');
    button.disabled=true;button.textContent='Sincronizando '+spec.name+'…';status.textContent='Consultando';message.textContent='Buscando saldos da conta '+spec.name+'…';
    try{
      const response=await fetch('/api/crypto/'+provider+'/account',{cache:'no-store'});const data=await response.json();
      if(response.status===401){location.reload();return;}if(!response.ok)throw new Error(data.error||'Não foi possível consultar a conta.');
      const previous=syncedBinance||{},snapshots={...(previous.exchanges||{})};
      const snapshot={exchange:provider,balances:Array.isArray(data.balances)?data.balances:[],updatedAt:data.updatedAt||new Date().toISOString()};
      snapshots[provider]=snapshot;syncedBinance={exchange:provider,selectedExchange:provider,balances:snapshot.balances,updatedAt:snapshot.updatedAt,exchanges:snapshots};
      localStorage.setItem(BINANCE_BALANCES_KEY,JSON.stringify(syncedBinance));renderCryptoPortfolio();await renderInvestmentAllocation();
      status.textContent='Sincronizada';message.textContent='Posição da '+spec.name+' atualizada em '+new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(snapshot.updatedAt))+'. Os saldos ficam somente em Investimentos.';
      if(!snapshot.balances.length)showToast('A conta '+spec.name+' não possui ativos com saldo para exibir.');
    }catch(error){const reason=error instanceof TypeError?'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.':error.message;status.textContent='Não sincronizada';message.textContent=reason;showToast(reason);}
    finally{button.disabled=false;button.textContent='Sincronizar '+spec.name;}
  }
  $('#addFixedCost').addEventListener('click',()=>{editingFixedId=null;$('#fixedCostForm').reset();$('#fixedDialogEyebrow').textContent='NOVO COMPROMISSO';$('#fixedDialogTitle').textContent='Adicionar custo fixo';$('#saveFixedCost').textContent='Salvar custo fixo';$('#fixedCostDialog').showModal();});
  $('#closeFixedDialog').addEventListener('click',()=>$('#fixedCostDialog').close());
  function openFixedPaidEdit(id,selectedMonth){const item=fixedCosts.find(entry=>String(entry.id)===String(id));if(!item)return;editingFixedPaidContext={id:String(id),month:selectedMonth};$('#fixedPaidDialogTitle').textContent=`${item.name} · ${new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(new Date(`${selectedMonth}-02T12:00:00`))}`;$('#fixedPaidForm').elements.amount.value=fixedPaidForMonth(item,selectedMonth).toFixed(2);$('#fixedPaidDialog').showModal();}
  $('#closeFixedPaidDialog').addEventListener('click',()=>$('#fixedPaidDialog').close());
  $('#fixedPaidForm').addEventListener('submit',(event)=>{event.preventDefault();if(!editingFixedPaidContext)return;const amount=Number(new FormData(event.currentTarget).get('amount'));if(!Number.isFinite(amount)||amount<0){showToast('Informe um valor pago válido.');return;}const item=fixedCosts.find(entry=>String(entry.id)===editingFixedPaidContext.id);if(!item)return;item.paidOverrides={...(item.paidOverrides||{}),[editingFixedPaidContext.month]:Math.round(amount*100)/100};localStorage.setItem(FIXED_KEY,JSON.stringify(fixedCosts));editingFixedPaidContext=null;$('#fixedPaidDialog').close();render();showToast('Valor pago atualizado para o mês selecionado.');});
  function openFixedPaymentAccount(id,occurrenceMonth){const item=fixedCosts.find(entry=>String(entry.id)===String(id));if(!item||fixedPaidForMonth(item,occurrenceMonth)>0)return;const amount=Math.round((Number(item.amount)||0)*100)/100;if(amount<=0){showToast('Cadastre um valor principal válido para este custo.');return;}payingFixedCostContext={id:String(id),month:occurrenceMonth};$('#fixedPaymentAccountTitle').textContent=`Pagar ${item.name}`;$('#fixedPaymentAccountAmount').textContent=`Valor principal a lançar: ${money(amount)}. Se o valor real for diferente, ajuste depois em Custos fixos.`;const select=$('#fixedPaymentBankAccount');select.replaceChildren(...bankAccounts.map(account=>new Option(account.name,String(account.id))));select.value=bankAccounts.some(account=>String(account.id)===String(selectedBankAccountId))?String(selectedBankAccountId):String(bankAccounts[0].id);$('#fixedPaymentAccountDialog').showModal();}
  $('#closeFixedPaymentAccountDialog').addEventListener('click',()=>$('#fixedPaymentAccountDialog').close());
  $('#fixedPaymentAccountForm').addEventListener('submit',(event)=>{event.preventDefault();if(!payingFixedCostContext)return;const accountId=String(new FormData(event.currentTarget).get('bankAccountId')||'');const account=bankAccounts.find(entry=>String(entry.id)===accountId);const item=fixedCosts.find(entry=>String(entry.id)===payingFixedCostContext.id);if(!account||!item){showToast('Selecione uma conta bancária válida.');return;}if(fixedPaidForMonth(item,payingFixedCostContext.month)>0){$('#fixedPaymentAccountDialog').close();payingFixedCostContext=null;render();showToast('Este custo já foi pago neste mês.');return;}const amount=Math.round((Number(item.amount)||0)*100)/100;if(amount<=0){showToast('Cadastre um valor principal válido para este custo.');return;}if(item.paidOverrides){delete item.paidOverrides[payingFixedCostContext.month];localStorage.setItem(FIXED_KEY,JSON.stringify(fixedCosts));}transactions.push({id:crypto.randomUUID?crypto.randomUUID():`fixed-payment-${Date.now()}-${Math.random()}`,description:item.name,type:'expense',category:item.name,amount,date:dateISO(today),paymentMethod:'pix',cardId:null,bankAccountId:accountId,installments:1,fixedCostId:String(item.id),fixedCostMonthKey:payingFixedCostContext.month,createdAt:Date.now()});selectedBankAccountId=accountId;localStorage.setItem(BANK_SELECTED_ACCOUNT_KEY,accountId);saveTransactions();payingFixedCostContext=null;$('#fixedPaymentAccountDialog').close();render();showToast(`${item.name} pago pela conta ${account.name} · ${money(amount)}.`);});
  $('#fixedCostForm').addEventListener('submit',(event)=>{event.preventDefault();const fd=new FormData(event.currentTarget);const amount=Number(fd.get('amount'));const dueDay=Number(fd.get('dueDay'));if(!Number.isFinite(amount)||amount<=0||!Number.isInteger(dueDay)||dueDay<1||dueDay>31){showToast('Confira o valor e o dia de vencimento.');return;}const values={name:String(fd.get('name')).trim(),amount,dueDay,bankMatchTerms:String(fd.get('bankMatchTerms')||'').trim()};if(editingFixedId!==null){const index=fixedCosts.findIndex(x=>String(x.id)===String(editingFixedId));if(index>=0)fixedCosts[index]={...fixedCosts[index],...values};}else fixedCosts.push({id:crypto.randomUUID?crypto.randomUUID():`fixed-${Date.now()}-${Math.random()}`,...values});localStorage.setItem(FIXED_KEY,JSON.stringify(fixedCosts));$('#fixedCostForm').reset();$('#fixedCostDialog').close();render();showToast(editingFixedId!==null?'Custo fixo atualizado.':'Custo fixo cadastrado.');editingFixedId=null;});
  function openFixedEdit(id){const item=fixedCosts.find(x=>String(x.id)===String(id));if(!item)return;editingFixedId=id;const form=$('#fixedCostForm');form.elements.name.value=item.name;form.elements.amount.value=item.amount;form.elements.dueDay.value=item.dueDay;form.elements.bankMatchTerms.value=item.bankMatchTerms||'';$('#fixedDialogEyebrow').textContent='EDITAR COMPROMISSO';$('#fixedDialogTitle').textContent='Editar custo fixo';$('#saveFixedCost').textContent='Salvar alterações';$('#fixedCostDialog').showModal();}
  function deleteFixedCost(id){const item=fixedCosts.find(x=>String(x.id)===String(id));if(!item||!confirm(`Apagar o custo fixo “${item.name}”?`))return;fixedCosts=fixedCosts.filter(x=>String(x.id)!==String(id));localStorage.setItem(FIXED_KEY,JSON.stringify(fixedCosts));render();showToast('Custo fixo apagado.');}
  $('#monthlyIncome').value=monthlyIncome?String(monthlyIncome.toFixed(2)):'';
  $('#fixedPercentInput').value=String(allocation.fixed);$('#cardPercentInput').value=String(allocation.card);$('#investmentPercentInput').value=String(allocation.investment);
  $('#editAllocation').addEventListener('click',()=>{const fields=$('#allocationSettingsFields'),opening=fields.hidden;if(opening){$('#fixedPercentInput').value=String(allocation.fixed);$('#cardPercentInput').value=String(allocation.card);$('#investmentPercentInput').value=String(allocation.investment);fields.hidden=false;$('#editAllocation').textContent='Cancelar';$('#editAllocation').setAttribute('aria-expanded','true');}else{fields.hidden=true;$('#editAllocation').textContent='Editar';$('#editAllocation').setAttribute('aria-expanded','false');}});
  $('#saveIncome').addEventListener('click',()=>{const value=Number($('#monthlyIncome').value);if(!Number.isFinite(value)||value<0){showToast('Informe uma renda mensal válida.');return;}monthlyIncome=value;localStorage.setItem(INCOME_KEY,String(monthlyIncome));render();showToast('Renda mensal salva; limite semanal atualizado.');});
  $('#saveAllocation').addEventListener('click',()=>{const raw={fixed:$('#fixedPercentInput').value.trim(),card:$('#cardPercentInput').value.trim(),investment:$('#investmentPercentInput').value.trim()};const next={fixed:Number(raw.fixed),card:Number(raw.card),investment:Number(raw.investment)};if(Object.values(raw).some(value=>value==='')||Object.values(next).some(value=>!Number.isFinite(value)||value<0||value>100)||Object.values(next).reduce((sum,value)=>sum+value,0)!==100){showToast('Preencha os três percentuais. A soma precisa ser exatamente 100%.');return;}allocation=next;localStorage.setItem(ALLOCATION_KEY,JSON.stringify(allocation));$('#allocationSettingsFields').hidden=true;$('#editAllocation').textContent='Editar';$('#editAllocation').setAttribute('aria-expanded','false');render();showToast('Percentuais salvos e metas atualizadas.');});
  $('#overviewMonthSelect').addEventListener('change',event=>{const [year,month]=event.currentTarget.value.split('-').map(Number);monthOffset=(year-today.getFullYear())*12+(month-1-today.getMonth());render();}); $('#prevWeek').addEventListener('click',()=>{monthOffset--;render();}); $('#nextWeek').addEventListener('click',()=>{monthOffset++;render();});
  const dialog=$('#transactionDialog');
  $('#newTransaction').addEventListener('click',()=>{editingId=null;const form=$('#transactionForm');form.reset();form.elements.date.value=dateISO(today);updateTransactionCategories(form.elements.type.value);updateCardPicker();$('#dialogEyebrow').textContent='NOVA MOVIMENTAÇÃO';$('#dialogTitle').textContent='Adicionar transação';$('#submitTransaction').textContent='Salvar transação';renderCards();dialog.showModal();});
  $('#closeDialog').addEventListener('click',()=>dialog.close());
  function updateTransactionCategories(type,selected=''){const select=$('#transactionForm').elements.category;const previous=selected;const options=type==='income'?['Salário','Aluguel','Dividendo','Freelancer']:[...new Set([...fixedCosts.map(item=>String(item.name||'').trim()).filter(Boolean),'Cartão de crédito','Lazer','Outros'])];select.replaceChildren();const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Selecione uma categoria';select.append(placeholder);for(const label of options){const option=document.createElement('option');option.value=label;option.textContent=label;select.append(option);}if(previous&&!options.includes(previous)){const legacy=document.createElement('option');legacy.value=previous;legacy.textContent=previous;select.append(legacy);}select.value=previous&&[...select.options].some(option=>option.value===previous)?previous:(options[0]||'');}
  function updateCardPicker(){const isCard=$('#paymentMethod').value==='cartao';$('#cardPickerLabel').hidden=!isCard;$('#transactionCard').required=isCard;const canInstall=$('#transactionForm').elements.type.value==='expense'&&['cartao','crediario','financiamento'].includes($('#paymentMethod').value);$('#installmentsField').hidden=!canInstall;$('#transactionInstallments').required=canInstall;if(!canInstall)$('#transactionInstallments').value='1';}
  $('#paymentMethod').addEventListener('change',updateCardPicker);
  $('#transactionForm').elements.type.addEventListener('change',()=>{updateTransactionCategories($('#transactionForm').elements.type.value);updateCardPicker();});
  $('#transactionForm').addEventListener('submit',(event)=>{event.preventDefault();const form=event.currentTarget;const fd=new FormData(form);const amount=Number(fd.get('amount'));if(!Number.isFinite(amount)||amount<=0){showToast('Informe um valor maior que zero.');return;}if(fd.get('paymentMethod')==='cartao'&&!fd.get('cardId')){showToast('Selecione o cartão de crédito usado.');return;}const count=['cartao','crediario','financiamento'].includes(fd.get('paymentMethod'))&&fd.get('type')==='expense'?Number(fd.get('installments')||1):1;if(!Number.isInteger(count)||count<1||count>120){showToast('Informe uma quantidade de parcelas entre 1 e 120.');return;}const selectedCard=cards.find(card=>String(card.id)===String(fd.get('cardId')));const existingTransaction=editingId!==null?transactions.find(t=>String(t.id)===String(editingId)):null;const cardTransaction=fd.get('paymentMethod')==='cartao'&&fd.get('type')==='expense';const values={description:String(fd.get('description')).trim(),type:fd.get('type'),category:fd.get('category'),amount,date:fd.get('date'),paymentMethod:fd.get('paymentMethod'),cardId:fd.get('paymentMethod')==='cartao'?(fd.get('cardId')||null):null,bankAccountId:fd.get('paymentMethod')==='cartao'?null:String(existingTransaction?.bankAccountId||selectedBankAccountId),installments:count,statementMonth:cardTransaction?(existingTransaction?.statementBatchId?existingTransaction.statementMonth:cardInvoiceMonth(fd.get('date'),selectedCard)):null};let savedId;if(editingId!==null){const index=transactions.findIndex(t=>String(t.id)===String(editingId));if(index>=0){transactions[index]={...transactions[index],...values};savedId=transactions[index].id;}}else{savedId=crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`;transactions.push({id:savedId,...values,createdAt:Date.now()});}const savedTransaction=transactions.find(t=>String(t.id)===String(savedId));if(savedId!==undefined)syncInstallments(savedId,savedTransaction);if(cardTransaction&&savedTransaction?.statementMonth)$('#cardMonthFilter').value=savedTransaction.statementMonth;saveTransactions();if(editingId===null)void addInAppNotification(savedTransaction,cardTransaction?'card':'bank',cardTransaction?(selectedCard?.name||'Cartão de crédito'):(bankAccounts.find(item=>String(item.id)===String(savedTransaction.bankAccountId))?.name||'Conta bancária'));form.reset();updateTransactionCategories(form.elements.type.value);updateCardPicker();dialog.close();render();if(editingId!==null)showToast('Transação atualizada.');else if(cardTransaction&&selectedCard){const invoiceLabel=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(new Date(`${savedTransaction.statementMonth}-02T12:00:00`));showToast(`Compra adicionada à fatura ${invoiceLabel} · ${selectedCard.name}.`);}else showToast('Transação adicionada.');editingId=null;});
  function openEdit(id){const transaction=transactions.find(t=>String(t.id)===String(id));if(!transaction)return;editingId=id;renderCards();const form=$('#transactionForm');form.elements.description.value=transaction.description;form.elements.type.value=transaction.type;updateTransactionCategories(transaction.type,transaction.category);form.elements.category.value=transaction.category;form.elements.amount.value=transaction.amount;form.elements.date.value=transaction.date;form.elements.paymentMethod.value=transaction.paymentMethod||(transaction.cardId?'cartao':'dinheiro');form.elements.installments.value=transaction.installments||1;updateCardPicker();form.elements.cardId.value=transaction.cardId||'';$('#dialogEyebrow').textContent='EDITAR MOVIMENTAÇÃO';$('#dialogTitle').textContent='Editar transação';$('#submitTransaction').textContent='Salvar alterações';dialog.showModal();}
  function syncInstallments(transactionId,transaction){fixedCosts=fixedCosts.filter(item=>String(item.sourceTransactionId)!==String(transactionId));if(transaction&&transaction.type==='expense'&&Number(transaction.installments)>1){const count=Number(transaction.installments);const [year,month,day]=transaction.date.split('-').map(Number);const card=cards.find(item=>String(item.id)===String(transaction.cardId));const dueDay=transaction.paymentMethod==='cartao'&&card?Number(card.dueDay):day;const totalCents=Math.round(Number(transaction.amount)*100);const baseCents=Math.floor(totalCents/count);const extraCents=totalCents%count;for(let index=1;index<=count;index++){const targetMonth=new Date(year,month-1+(transaction.paymentMethod==='cartao'&&card&&day>cardClosingDay(card)?2:1)+index-1,1);const finalDay=new Date(targetMonth.getFullYear(),targetMonth.getMonth()+1,0).getDate();const installmentAmount=(baseCents+(index<=extraCents?1:0))/100;fixedCosts.push({id:`installment-${transactionId}-${index}`,name:transaction.description,amount:installmentAmount,dueDay:Math.min(dueDay,finalDay),monthKey:monthKey(targetMonth),installmentIndex:index,installmentCount:count,sourceTransactionId:transactionId});}}localStorage.setItem(FIXED_KEY,JSON.stringify(fixedCosts));}
  function deleteTransaction(id){const transaction=transactions.find(t=>String(t.id)===String(id));if(!transaction||!confirm(`Apagar a transação “${transaction.description}” e as parcelas futuras geradas por ela?`))return;transactions=transactions.filter(t=>String(t.id)!==String(id));fixedCosts=fixedCosts.filter(item=>String(item.sourceTransactionId)!==String(id));localStorage.setItem(FIXED_KEY,JSON.stringify(fixedCosts));saveTransactions();render();showToast('Transação e parcelas futuras apagadas.');}
  function saveTransactions(){localStorage.setItem(TX_KEY,JSON.stringify(transactions));}
  function saveCards(){localStorage.setItem(CARD_KEY,JSON.stringify(cards));}
  $('#addCard').addEventListener('click',()=>{editingCardId=null;const form=$('#cardForm');form.reset();$('#cardDialogEyebrow').textContent='NOVO CARTÃO';$('#cardDialogTitle').textContent='Cadastrar cartão';$('#saveCard').textContent='Salvar cartão';$('#cardDialog').showModal();});
  $('#closeCardDialog').addEventListener('click',()=>$('#cardDialog').close());
  function openCardEdit(id){const card=cards.find(item=>String(item.id)===String(id));if(!card)return;editingCardId=id;const form=$('#cardForm');form.elements.name.value=card.name;form.elements.limit.value=card.limit;form.elements.closingDay.value=cardClosingDay(card);form.elements.dueDay.value=card.dueDay;$('#cardDialogEyebrow').textContent='EDITAR CARTÃO';$('#cardDialogTitle').textContent='Editar cartão';$('#saveCard').textContent='Salvar alterações';$('#cardDialog').showModal();}
  $('#cardForm').addEventListener('submit',(event)=>{event.preventDefault();const form=event.currentTarget;const fd=new FormData(form);const limit=Number(fd.get('limit'));const closingDay=Number(fd.get('closingDay'));const dueDay=Number(fd.get('dueDay'));if(!Number.isFinite(limit)||limit<=0||!Number.isInteger(closingDay)||closingDay<1||closingDay>31||!Number.isInteger(dueDay)||dueDay<1||dueDay>31){showToast('Confira o limite e os dias de fechamento e vencimento.');return;}const values={name:String(fd.get('name')).trim(),limit,closingDay,dueDay};if(editingCardId!==null){const index=cards.findIndex(card=>String(card.id)===String(editingCardId));if(index>=0)cards[index]={...cards[index],...values};saveCards();form.reset();$('#cardDialog').close();render();showToast('Cartão atualizado.');editingCardId=null;return;}cards.push({id:crypto.randomUUID?crypto.randomUUID():`card-${Date.now()}-${Math.random()}`,...values});saveCards();form.reset();$('#cardDialog').close();render();showToast('Cartão cadastrado.');});
  function removeCard(id){const card=cards.find(c=>String(c.id)===String(id));if(!card||!confirm(`Remover o cartão “${card.name}”? As transações associadas continuarão salvas sem vínculo ao cartão.`))return;cards=cards.filter(c=>String(c.id)!==String(id));transactions=transactions.map(t=>String(t.cardId)===String(id)?{...t,cardId:null}:t);saveCards();saveTransactions();render();showToast('Cartão removido.');}

  function readStatementText(file){return file.arrayBuffer().then(buffer=>{const bytes=new Uint8Array(buffer);if(bytes[0]===0xff&&bytes[1]===0xfe)return new TextDecoder('utf-16le').decode(bytes.slice(2));if(bytes[0]===0xfe&&bytes[1]===0xff)return new TextDecoder('utf-16be').decode(bytes.slice(2));let text=new TextDecoder('utf-8').decode(bytes);if(text.includes('\uFFFD'))text=new TextDecoder('windows-1252').decode(bytes);return text;});}
  function statementBatchId(source,cardId,selectedMonth){let hash=2166136261;if(source instanceof Uint8Array){for(const byte of source)hash=Math.imul(hash^byte,16777619);}else{for(let index=0;index<source.length;index++)hash=Math.imul(hash^source.charCodeAt(index),16777619);}return`statement-${(hash>>>0).toString(16)}-${cardId}-${selectedMonth}`;}
  let pdfjsLibraryPromise;
  function loadPDFJS(){if(!pdfjsLibraryPromise)pdfjsLibraryPromise=import('/vendor/pdfjs/pdf.min.mjs').then(pdfjs=>{pdfjs.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/pdf.worker.min.mjs';return pdfjs;});return pdfjsLibraryPromise;}
  async function parsePDFInvoice(bytes,selectedMonth){
    const pdfjs=await loadPDFJS(),loadingTask=pdfjs.getDocument({data:bytes,useSystemFonts:true});
    let invoiceTotal=null;
    const lines=[];
    try{
      const document=await loadingTask.promise;
      if(document.numPages>40)throw new Error('A fatura PDF tem mais de 40 páginas. Divida o arquivo e importe cada parte.');
      for(let pageNumber=1;pageNumber<=document.numPages;pageNumber++){
        const page=await document.getPage(pageNumber),content=await page.getTextContent(),grouped=new Map();
        for(const item of content.items){
          if(typeof item.str!=='string'||!item.str.trim())continue;
          const x=Number(item.transform?.[4]||0),y=Number(item.transform?.[5]||0),key=Math.round(y/2)*2;
          if(!grouped.has(key))grouped.set(key,{y,items:[]});
          grouped.get(key).items.push({x,text:item.str});
        }
        for(const line of [...grouped.values()].sort((a,b)=>b.y-a.y)){
          const text=line.items.sort((a,b)=>a.x-b.x).map(item=>item.text).join(' ').replace(/\s+/g,' ').trim();
          if(text)lines.push(text);
        }
        page.cleanup();
      }
    }finally{await loadingTask.destroy().catch(()=>{});}
    const normalized=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const parseAmount=raw=>{const source=String(raw||'').trim();const negative=/^[-−(]/.test(source);let value=source.replace(/R\$/gi,'').replace(/[\s()]/g,'').replace(/^[-−]/,'');if(value.includes(','))value=value.replace(/\./g,'').replace(',','.');const amount=Number(value);return Number.isFinite(amount)?(negative?-Math.abs(amount):Math.abs(amount)):0;};
    const invoiceTotalPattern=/(?:total\s+(?:(?:da|de|desta|do)\s+)?fatura|valor\s+total\s+(?:da\s+)?fatura|total\s+a\s+pagar|total\s+geral)/;
    const nonPurchasePattern=/\b(?:pag\s+boleto|pagamento\s+(?:de\s+)?(?:fatura|boleto)|pagto\s+(?:da\s+)?fatura|pgto\s+(?:da\s+)?fatura)\b/;
    // Aceita linhas DD/MM DESCRIÇÃO VALOR e encerra no primeiro valor monetário.
    const transactionLinePattern=/^\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+(.+?)\s+((?:R\$\s*)?[-−]?\s*\(?\d+(?:\.\d{3})*,\d{2}\)?)(?:\s*([-−]))?(?=\s|$)/;
    const output=[];
    for(const line of lines){
      const plain=normalized(line);
      if(invoiceTotalPattern.test(plain)&&!/(fatura anterior|saldo anterior)/.test(plain)){const totalMatch=line.match(/(?:R\$\s*)?[-−]?\s*\(?\d+(?:[.\s]\d{3})*(?:,\d{2}|\.\d{2})\)?/g);if(totalMatch?.length)invoiceTotal=Math.abs(parseAmount(totalMatch[totalMatch.length-1]));continue;}
      const transactionMatch=line.match(transactionLinePattern);
      if(!transactionMatch)continue;
      const [,dayText,monthText,yearText,description,signedAmountText,trailingSign]=transactionMatch;
      const signedAmount=trailingSign?-Math.abs(parseAmount(signedAmountText)):parseAmount(signedAmountText);
      if(!signedAmount)continue;
      const day=Number(dayText),month=Number(monthText);
      let year=Number(yearText||selectedMonth.slice(0,4));
      if(year<100)year+=year<70?2000:1900;
      const validDate=new Date(Date.UTC(year,month-1,day));
      if(validDate.getUTCFullYear()!==year||validDate.getUTCMonth()!==month-1||validDate.getUTCDate()!==day)continue;
      const cleanDescription=description.replace(/[|•·]+/g,' ').replace(/\s+/g,' ').trim();
      if(!/[A-Za-zÀ-ÿ]/.test(cleanDescription)||nonPurchasePattern.test(normalized(cleanDescription)))continue;
      const installmentMatch=cleanDescription.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\b/),currentInstallment=installmentMatch?Number(installmentMatch[1]):1,installmentCount=installmentMatch?Number(installmentMatch[2]):1;
      const validInstallment=installmentMatch&&currentInstallment>=1&&installmentCount>=currentInstallment&&installmentCount<=120;
      output.push({id:`pdf-${Date.now()}-${Math.random()}`,date:`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`,description:cleanDescription,category:'Fatura de cartão',amount:Math.abs(signedAmount),type:signedAmount<0?'income':'expense',installments:validInstallment?installmentCount:1,currentInstallment:validInstallment?currentInstallment:1,createdAt:Date.now()});
    }
    output.sort((a,b)=>b.date.localeCompare(a.date)||a.description.localeCompare(b.description,'pt-BR'));
    return{transactions:output,invoiceTotal};
  }  async function importCardStatement(file){
    const cardId=$('#statementCardId').value,card=cards.find(item=>String(item.id)===String(cardId));
    if(!card){showToast('Selecione o cartão da fatura antes de importar.');return;}
    if(file.size>20*1024*1024)throw new Error('O arquivo excede o limite de 20 MB.');
    const selectedMonth=$('#cardMonthFilter').value||monthKey(today),bytes=new Uint8Array(await file.arrayBuffer());
    const isPdf=/\.pdf$/i.test(file.name)||bytes[0]===0x25&&bytes[1]===0x50&&bytes[2]===0x44&&bytes[3]===0x46;
    const text=isPdf?'':await readStatementText(file),source=isPdf?bytes:text,batchId=statementBatchId(source,card.id,selectedMonth),batchAlreadyImported=transactions.some(item=>item.statementBatchId===batchId);
    let parsed=[],invoiceTotal=null;
    if(isPdf){const extraction=await parsePDFInvoice(bytes,selectedMonth);parsed=extraction.transactions;invoiceTotal=extraction.invoiceTotal;}
    else parsed=/\.ofx$/i.test(file.name)||/<OFX>/i.test(text)?parseOFX(text):parseCSV(text,{cardStatement:true});
    if(!parsed.length){showToast(isPdf?'Não encontrei lançamentos de compra com data e valor no PDF. Pagamentos, totais e saldos são ignorados; PDFs escaneados ou protegidos por senha não podem ser lidos.':'Não encontrei compras com data e valor. Confira se o CSV tem cabeçalho Data e Valor, ou Data, Crédito e Débito.');return;}
    const importedTotal=parsed.reduce((sum,item)=>sum+(item.type==='income'?-1:1)*(Number(item.amount)||0),0);
    const imported=parsed.map(item=>({...item,category:item.category&&item.category!=='Importado'?item.category:'Fatura de cartão',paymentMethod:'cartao',cardId:String(card.id),installments:Math.max(1,Number(item.installments)||1),currentInstallment:Math.max(1,Number(item.currentInstallment)||1),statementMonth:selectedMonth,statementBatchId:batchId,statementInvoiceTotal:invoiceTotal,statementImportedTotal:importedTotal,statementFormat:isPdf?'pdf':/\.ofx$/i.test(file.name)?'ofx':'csv'}));
    transactions=transactions.filter(item=>item.statementBatchId!==batchId);
    transactions.push(...imported);saveTransactions();render();if(!batchAlreadyImported)for(const transaction of imported.filter(item=>item.type==='expense'))addInAppNotification(transaction,'card',card.name,`${batchId}:${transaction.id}`);
    const result=invoiceTotal===null?'Total da fatura não identificado no arquivo.':Math.abs(invoiceTotal-importedTotal)<=0.01?'A soma dos lançamentos bate com o total da fatura.':`Diferença de ${money(Math.abs(invoiceTotal-importedTotal))} entre lançamentos e fatura.`;
    showToast(`${imported.length} lançamentos importados. ${result}`);
  }  function parseCSV(text,{cardStatement=false}={}){
    text=String(text||'').replace(/^\uFEFF/,'').replace(/\u0000/g,'');
    const normalize=value=>String(value||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[():]/g,' ').replace(/\s+/g,' ').trim();
    const parseRows=delimiter=>{const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'&&quoted&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"'){quoted=!quoted;}else if(c===delimiter&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';}else cell+=c;}row.push(cell);if(row.some(x=>x.trim()))rows.push(row);return rows;};
    const candidates=[';',',','\t'].map(delimiter=>({delimiter,rows:parseRows(delimiter)})).sort((a,b)=>Math.max(...b.rows.slice(0,30).map(row=>row.length))-Math.max(...a.rows.slice(0,30).map(row=>row.length)));
    let selected=null;
    for(const candidate of candidates){const rows=candidate.rows;const headerIndex=rows.findIndex(row=>{const headers=row.map(normalize);const hasDate=headers.some(h=>h==='data'||h.startsWith('data ')||h==='date'||h.startsWith('dt '));const hasValue=headers.some(h=>/^(amount|quantia|valor)( |$)/.test(h)&&!h.includes('saldo')||/(credito|debito|entrada|saida|deposito|retirada)/.test(h));return hasDate&&hasValue;});if(headerIndex>=0){selected={...candidate,headerIndex,headers:rows[headerIndex].map(normalize)};break;}}
    if(!selected)throw new Error('O CSV não foi reconhecido. Procure cabeçalhos Data e Valor, ou Data, Crédito e Débito.');
    const {rows,headerIndex,headers}=selected;
    const find=keys=>headers.findIndex(h=>keys.some(k=>h===k||h.startsWith(k+' ')||h.includes(k)));
    const dateIndex=find(['data','date','dt']);let descIndex=headers.findIndex((h,index)=>index!==dateIndex&&/(descricao|historico|memo|favorecido|beneficiario|detalhe|lancamento|estabelecimento|estab|merchant|loja|comerciante|comercio|nome fantasia|nome do local)/.test(h));const categoryIndex=find(['categoria']),typeIndex=find(['tipo','natureza']);
    const amountIndex=headers.findIndex(h=>/^(amount|quantia|valor)( |$)/.test(h)&&!/(saldo|credito|debito)/.test(h));
    const creditIndex=headers.findIndex(h=>/(credito|entrada|deposito)/.test(h)&&!h.includes('saldo'));
    const debitIndex=headers.findIndex(h=>/(debito|saida|retirada)/.test(h)&&!h.includes('saldo'));
    const balanceIndex=cardStatement?-1:headers.findIndex(h=>/saldo|balance/.test(h)&&!/(anterior|inicial|opening|previous|limite|disponivel)/.test(h));
    if(amountIndex<0&&creditIndex<0&&debitIndex<0)throw new Error('Não encontrei coluna de valor, crédito ou débito no CSV.');
    const parseAmount=value=>{let raw=String(value||'').trim().replace(/[\u00a0\s]/g,'');if(!raw||/^[-–—]+$/.test(raw))return 0;const negative=/^-|\(.*\)|-$/.test(raw);raw=raw.replace(/R\$/gi,'').replace(/[()]/g,'').replace(/[^\d,.-]/g,'');if(raw.includes(',')&&raw.lastIndexOf(',')>raw.lastIndexOf('.'))raw=raw.replace(/\./g,'').replace(',','.');else raw=raw.replace(/,/g,'');const valueNumber=Math.abs(Number(raw));return Number.isFinite(valueNumber)?(negative?-valueNumber:valueNumber):0;};
    const parseDate=value=>{let date=String(value||'').trim();let match=date.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4}|\d{2})/);if(match){let year=Number(match[3]);if(year<100)year+=year<70?2000:1900;date=year+'-'+String(match[2]).padStart(2,'0')+'-'+String(match[1]).padStart(2,'0');}else{match=date.match(/^(\d{4})-(\d{2})-(\d{2})/);if(match)date=match[1]+'-'+match[2]+'-'+match[3];}if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return '';const [year,month,day]=date.split('-').map(Number);const parsed=new Date(Date.UTC(year,month-1,day));return parsed.getUTCFullYear()===year&&parsed.getUTCMonth()===month-1&&parsed.getUTCDate()===day?date:'';};
    const output=[];
    for(const cols of rows.slice(headerIndex+1)){
      const date=parseDate(cols[dateIndex]);if(!date)continue;
      let signedAmount=0,type='';
      if(amountIndex>=0){signedAmount=parseAmount(cols[amountIndex]);const markedType=normalize(cols[typeIndex]||'');type=/entrada|credito|credit|receita|deposito/.test(markedType)?'income':/saida|debito|debit|despesa|pagamento|retirada/.test(markedType)?'expense':'';}
      else{const credit=parseAmount(cols[creditIndex]),debit=parseAmount(cols[debitIndex]);if(credit!==0){signedAmount=Math.abs(credit);type='income';}else if(debit!==0){signedAmount=-Math.abs(debit);type='expense';}}
      if(!signedAmount)continue;
      type=type||(cardStatement?(signedAmount<0?'income':'expense'):(signedAmount<0?'expense':'income'));
      const description=String(cols[descIndex]||'').trim()||'Transação importada';
      const transaction={id:'import-'+Date.now()+'-'+Math.random(),date,description,category:String(cols[categoryIndex]||'').trim()||'Importado',amount:Math.abs(signedAmount),type,createdAt:Date.now()};
      if(balanceIndex>=0){const balanceText=String(cols[balanceIndex]||'').trim();if(balanceText&&!/^[-–—]+$/.test(balanceText)){const statementBalance=parseAmount(balanceText);if(Number.isFinite(statementBalance)){transaction.statementBalance=statementBalance;transaction.statementBalanceDate=date;transaction.statementBalanceKind='running';}}}
      output.push(transaction);
    }
    return output;
  }
  function parseOFX(text){const transactionsFound=[];const blocks=text.split(/<STMTTRN>/i).slice(1);for(const block of blocks){const get=tag=>((block.match(new RegExp('<'+tag+'>([^<\\r\\n]+)','i'))||[])[1]||'').trim();let date=get('DTPOSTED').slice(0,8);if(!/^\d{8}$/.test(date))continue;date=date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6,8);const signed=Number(get('TRNAMT').replace(',','.'));if(!Number.isFinite(signed)||signed===0)continue;transactionsFound.push({id:'ofx-'+Date.now()+'-'+Math.random(),date,description:get('MEMO')||get('NAME')||'Transação importada',category:'Importado',amount:Math.abs(signed),type:signed<0?'expense':'income',createdAt:Date.now()});}const ledger=(text.match(/<LEDGERBAL>([\s\S]*?)<\/LEDGERBAL>/i)||[])[1]||'';const balanceText=((ledger.match(/<BALAMT>([^<\r\n]+)/i)||[])[1]||'').trim();const balanceDate=((ledger.match(/<DTASOF>([^<\r\n]+)/i)||[])[1]||'').trim().slice(0,8);const balance=Number(balanceText.replace(',','.'));if(transactionsFound.length&&/^\d{8}$/.test(balanceDate)&&Number.isFinite(balance)){const snapshot=transactionsFound[transactionsFound.length-1];snapshot.statementBalance=balance;snapshot.statementBalanceDate=balanceDate.slice(0,4)+'-'+balanceDate.slice(4,6)+'-'+balanceDate.slice(6,8);snapshot.statementBalanceKind='period-close';}return transactionsFound;}
  function updateOpeningBalanceFromStatement(imported){
    const accountId=String(imported[0]?.bankAccountId||selectedBankAccountId);
    const snapshots=imported.filter(item=>Number.isFinite(Number(item.statementBalance))&&/^\d{4}-\d{2}-\d{2}$/.test(String(item.statementBalanceDate||'')));
    if(!snapshots.length)return false;
    const byMonth=new Map();
    for(const item of snapshots){const month=String(item.statementBalanceDate).slice(0,7);if(!byMonth.has(month))byMonth.set(month,[]);byMonth.get(month).push(item);}
    const updates=new Map(),monthsToRecalculate=new Set();
    for(const [month,monthSnapshots] of byMonth){
      const running=monthSnapshots.filter(item=>item.statementBalanceKind!=='period-close');
      let openingBalance;
      if(running.length){
        const firstDate=running.map(item=>String(item.statementBalanceDate)).sort()[0];
        const firstMovement=running.filter(item=>String(item.statementBalanceDate)===firstDate).sort((x,y)=>Number(x.createdAt||0)-Number(y.createdAt||0))[0];
        if(!firstMovement)continue;
        const reverseMovement=firstMovement.type==='expense'?Math.abs(Number(firstMovement.amount)||0):-Math.abs(Number(firstMovement.amount)||0);
        openingBalance=Number(firstMovement.statementBalance)+reverseMovement;
      }else{
        const closing=monthSnapshots.slice().sort((x,y)=>String(y.statementBalanceDate).localeCompare(String(x.statementBalanceDate)))[0];
        const snapshotDate=String(closing.statementBalanceDate),monthStart=month+'-01';
        const netThroughSnapshot=imported.filter(item=>String(item.date||'')>=monthStart&&String(item.date||'')<=snapshotDate).reduce((sum,item)=>sum+(item.type==='income'?1:-1)*Math.abs(Number(item.amount)||0),0);
        openingBalance=Number(closing.statementBalance)-netThroughSnapshot;
      }
      if(!Number.isFinite(openingBalance))continue;
      const [year,monthNumber]=month.split('-').map(Number),previousMonth=monthKey(new Date(year,monthNumber-2,1));
      updates.set(previousMonth,openingBalance);monthsToRecalculate.add(month);
    }
    let changed=false;
    for(const month of monthsToRecalculate){const key=bankBalanceKey(accountId,month);if(Object.prototype.hasOwnProperty.call(bankBalanceOverrides,key)){delete bankBalanceOverrides[key];changed=true;}if(String(accountId)===String(bankAccounts[0]?.id)&&Object.prototype.hasOwnProperty.call(bankBalanceOverrides,month)){delete bankBalanceOverrides[month];changed=true;}}
    for(const [month,balance] of updates){const key=bankBalanceKey(accountId,month);if(Math.round((Number(bankBalanceOverrides[key])||0)*100)!==Math.round(balance*100)){bankBalanceOverrides[key]=balance;changed=true;}}
    if(changed)localStorage.setItem(BANK_BALANCE_KEY,JSON.stringify(bankBalanceOverrides));
    return updates.size>0;
  }
  $('#statementFile').addEventListener('change',async(event)=>{const file=event.target.files?.[0];if(!file)return;try{const bytes=new Uint8Array(await file.arrayBuffer());let text;if(bytes[0]===0xff&&bytes[1]===0xfe)text=new TextDecoder('utf-16le').decode(bytes.slice(2));else if(bytes[0]===0xfe&&bytes[1]===0xff)text=new TextDecoder('utf-16be').decode(bytes.slice(2));else{text=new TextDecoder('utf-8').decode(bytes);if(text.includes('\uFFFD'))text=new TextDecoder('windows-1252').decode(bytes);}const accountId=selectedBankAccountId;const parsed=(/\.ofx$/i.test(file.name)||/<OFX>/i.test(text)?parseOFX(text):parseCSV(text)).map(item=>({...item,bankAccountId:accountId}));if(!parsed.length){showToast('O arquivo foi lido, mas não encontrei movimentações com data e valor preenchidos.');return;}const balanceUpdated=updateOpeningBalanceFromStatement(parsed);let updatedCount=0;const newTransactions=[];for(const item of parsed){const signature=transaction=>String(transaction.date||'')+'|'+String(transaction.description||'')+'|'+String(transaction.type||'')+'|'+Math.round((Number(transaction.amount)||0)*100);const existing=transactions.find(transaction=>/^(import|ofx)-/.test(String(transaction.id||''))&&transactionBankAccountId(transaction)===accountId&&signature(transaction)===signature(item));if(existing){Object.assign(existing,item,{id:existing.id,createdAt:existing.createdAt||item.createdAt});updatedCount++;}else{transactions.push(item);newTransactions.push(item);}}saveTransactions();render();for(const item of newTransactions)addInAppNotification(item,'bank',bankAccounts.find(account=>String(account.id)===String(accountId))?.name||'Conta bancária');showToast(`${parsed.length} lançamentos importados para ${bankAccounts.find(item=>String(item.id)===String(accountId))?.name||'a conta selecionada'} · ${updatedCount} atualizados${balanceUpdated?'; saldo inicial recalculado':''}.`);}catch(error){showToast(error.message||'Não foi possível importar este extrato.');}finally{event.target.value='';}});
  $('#clearData').addEventListener('click',()=>{if(!confirm('Apagar transações, cartões, contas bancárias, custos fixos, investimentos, renda mensal e percentuais salvos nesta conta?'))return;transactions=[];appNotifications=[];localStorage.removeItem(NOTIFICATIONS_KEY);renderNotifications();cards=[];fixedCosts=[];investments=[];bankAccounts=[{id:'main',name:'Conta principal'}];selectedBankAccountId='main';monthlyIncome=0;allocation={fixed:50,card:40,investment:10};budget=0;localStorage.removeItem(TX_KEY);localStorage.removeItem(CARD_KEY);localStorage.removeItem(FIXED_KEY);localStorage.removeItem(INVESTMENT_KEY);localStorage.removeItem(INCOME_KEY);localStorage.removeItem(ALLOCATION_KEY);localStorage.removeItem(BANK_BALANCE_KEY);localStorage.removeItem(BANK_ACCOUNTS_KEY);localStorage.removeItem(BANK_SELECTED_ACCOUNT_KEY);bankBalanceOverrides={};$('#monthlyIncome').value='';$('#fixedPercentInput').value='50';$('#cardPercentInput').value='40';$('#investmentPercentInput').value='10';$('#allocationSettingsFields').hidden=true;$('#editAllocation').textContent='Editar';$('#editAllocation').setAttribute('aria-expanded','false');localStorage.setItem(BANK_ACCOUNTS_KEY,JSON.stringify(bankAccounts));localStorage.setItem(BANK_SELECTED_ACCOUNT_KEY,selectedBankAccountId);render();showToast('Dados apagados.');});
  renderNotifications();
  render();
  fetch('/api/session',{cache:'no-store'}).then(response=>response.ok?response.json():null).then(session=>{if(!session?.username)return;const name=String(session.username).trim();if(!name)return;$('#greetingName').textContent=`${name.charAt(0).toLocaleUpperCase('pt-BR')}${name.slice(1)}!`;}).catch(()=>{});
})();

