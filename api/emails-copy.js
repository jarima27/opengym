/* The lifecycle emails' words (emails.js), one block per language — the register each app pack
   uses (tú, du, tu, você…), and "Coach", "Tiza" as the app says them. {name} is the profile's
   name; nothing else is filled in here: numbers go in their own cells, so no plural rules. */

export const EMAIL_COPY = {
  en: {
    welcome: { subject: 'Welcome to Tiza', titleName: 'Welcome, {name}!', title: 'Welcome to Tiza!', body: 'Your plan is ready. On a training day, open the app and tap Start: Tiza takes you through it set by set, works out the weights, and raises them when you complete every rep.', tip: 'Turn on reminders and we’ll tell you when it’s time to train.', cta: 'Open Tiza' },
    day3: { subject: 'Your first workout is waiting', title: 'Ready for your first session?', body: 'Three days in and no workout yet — that’s normal, the first one is the hardest to start. Your plan is ready: open Tiza and tap Start. If you don’t know your weights, Tiza finds them with you in that first session.', cta: 'Start my first workout' },
    week1: { subject: 'Your first week with Tiza', title: 'Your first week', workouts: 'Workouts', sets: 'Sets', volume: 'Volume', records: 'Records', body: 'A good start. Keep the same rhythm next week: showing up beats everything else.', title0: 'Your plan is still waiting', body0: 'No workouts this first week — it happens. One short session is all it takes to get going; your weights are already worked out.', cta: 'Open Tiza' },
    footer: { why: 'You’re getting this because you created an account on Tiza.', unsub: 'Unsubscribe' },
    page: { title: 'You won’t get these emails any more', body: 'Your account and your training stay exactly as they are.', again: 'Subscribe again', resubbed: 'Done — you’ll get them again.' }
  },
  es: {
    welcome: { subject: 'Te damos la bienvenida a Tiza', titleName: '¡Hola, {name}!', title: '¡Te damos la bienvenida a Tiza!', body: 'Tu plan está listo. El día que toque entrenar, abre la app y pulsa Empezar: Tiza te guía serie a serie, calcula los pesos y los sube cuando completas todas las repeticiones.', tip: 'Activa los avisos y te diremos cuándo toca entrenar.', cta: 'Abrir Tiza' },
    day3: { subject: 'Tu primer entreno te espera', title: '¿Listo para tu primera sesión?', body: 'Llevas tres días y aún no has entrenado: es normal, la primera sesión es la que más cuesta empezar. Tu plan está listo: abre Tiza y pulsa Empezar. Si no sabes tus pesos, Tiza te ayuda a encontrarlos en esa primera sesión.', cta: 'Empezar mi primer entreno' },
    week1: { subject: 'Tu primera semana con Tiza', title: 'Tu primera semana', workouts: 'Entrenos', sets: 'Series', volume: 'Volumen', records: 'Récords', body: 'Un buen comienzo. Mantén el ritmo la semana que viene: lo que más cuenta es aparecer.', title0: 'Tu plan sigue esperándote', body0: 'Esta primera semana no ha habido entrenos; pasa. Basta una sesión corta para arrancar, y tus pesos ya están calculados.', cta: 'Abrir Tiza' },
    footer: { why: 'Recibes este correo porque creaste una cuenta en Tiza.', unsub: 'Darme de baja' },
    page: { title: 'Ya no recibirás estos correos', body: 'Tu cuenta y tus entrenos siguen exactamente igual.', again: 'Volver a suscribirme', resubbed: 'Hecho: volverás a recibirlos.' }
  },
  pt: {
    welcome: { subject: 'Bem-vindo ao Tiza', titleName: 'Olá, {name}!', title: 'Bem-vindo ao Tiza!', body: 'O teu plano está pronto. No dia de treino, abre a app e toca em Começar: o Tiza guia-te série a série, calcula os pesos e sobe-os quando completas todas as repetições.', tip: 'Ativa os lembretes e avisamos-te quando for altura de treinar.', cta: 'Abrir o Tiza' },
    day3: { subject: 'O teu primeiro treino está à espera', title: 'Pronto para a primeira sessão?', body: 'Já passaram três dias e ainda não treinaste — é normal, a primeira sessão é a que mais custa começar. O teu plano está pronto: abre o Tiza e toca em Começar. Se não sabes os teus pesos, o Tiza ajuda-te a encontrá-los nessa primeira sessão.', cta: 'Começar o primeiro treino' },
    week1: { subject: 'A tua primeira semana com o Tiza', title: 'A tua primeira semana', workouts: 'Treinos', sets: 'Séries', volume: 'Volume', records: 'Recordes', body: 'Um bom começo. Mantém o ritmo na próxima semana: o que mais conta é aparecer.', title0: 'O teu plano continua à espera', body0: 'Nesta primeira semana não houve treinos — acontece. Basta uma sessão curta para arrancar; os teus pesos já estão calculados.', cta: 'Abrir o Tiza' },
    footer: { why: 'Recebes este email porque criaste uma conta no Tiza.', unsub: 'Cancelar subscrição' },
    page: { title: 'Já não vais receber estes emails', body: 'A tua conta e os teus treinos ficam exatamente como estão.', again: 'Voltar a subscrever', resubbed: 'Feito — vais voltar a recebê-los.' }
  },
  'pt-BR': {
    welcome: { subject: 'Boas-vindas ao Tiza', titleName: 'Olá, {name}!', title: 'Boas-vindas ao Tiza!', body: 'Seu plano está pronto. No dia de treino, abra o app e toque em Começar: o Tiza guia você série a série, calcula os pesos e aumenta quando você completa todas as repetições.', tip: 'Ative os lembretes e avisamos quando for hora de treinar.', cta: 'Abrir o Tiza' },
    day3: { subject: 'Seu primeiro treino está esperando', title: 'Pronto para a primeira sessão?', body: 'Já se passaram três dias e você ainda não treinou — é normal, a primeira sessão é a mais difícil de começar. Seu plano está pronto: abra o Tiza e toque em Começar. Se não souber seus pesos, o Tiza ajuda a encontrá-los nessa primeira sessão.', cta: 'Começar meu primeiro treino' },
    week1: { subject: 'Sua primeira semana com o Tiza', title: 'Sua primeira semana', workouts: 'Treinos', sets: 'Séries', volume: 'Volume', records: 'Recordes', body: 'Um bom começo. Mantenha o ritmo na próxima semana: o que mais conta é aparecer.', title0: 'Seu plano continua esperando', body0: 'Nenhum treino nesta primeira semana — acontece. Uma sessão curta basta para começar; seus pesos já estão calculados.', cta: 'Abrir o Tiza' },
    footer: { why: 'Você recebe este e-mail porque criou uma conta no Tiza.', unsub: 'Cancelar inscrição' },
    page: { title: 'Você não vai mais receber estes e-mails', body: 'Sua conta e seus treinos continuam exatamente como estão.', again: 'Inscrever-me de novo', resubbed: 'Pronto — você vai voltar a recebê-los.' }
  },
  de: {
    welcome: { subject: 'Willkommen bei Tiza', titleName: 'Hallo, {name}!', title: 'Willkommen bei Tiza!', body: 'Dein Plan steht. Öffne an einem Trainingstag die App und tippe auf Starten: Tiza führt dich Satz für Satz durch, rechnet die Gewichte aus und erhöht sie, wenn du alle Wiederholungen schaffst.', tip: 'Schalte die Erinnerungen ein, dann sagen wir dir, wann Training ansteht.', cta: 'Tiza öffnen' },
    day3: { subject: 'Dein erstes Training wartet', title: 'Bereit für deine erste Einheit?', body: 'Drei Tage dabei und noch kein Training — ganz normal, die erste Einheit ist am schwersten anzufangen. Dein Plan steht: Öffne Tiza und tippe auf Starten. Wenn du deine Gewichte nicht kennst, findet Tiza sie in dieser ersten Einheit mit dir.', cta: 'Mein erstes Training starten' },
    week1: { subject: 'Deine erste Woche mit Tiza', title: 'Deine erste Woche', workouts: 'Trainings', sets: 'Sätze', volume: 'Volumen', records: 'Rekorde', body: 'Ein guter Anfang. Halt nächste Woche denselben Rhythmus: Dranbleiben schlägt alles andere.', title0: 'Dein Plan wartet noch', body0: 'Diese erste Woche ohne Training — das passiert. Eine kurze Einheit reicht, um loszulegen; deine Gewichte sind schon ausgerechnet.', cta: 'Tiza öffnen' },
    footer: { why: 'Du bekommst diese E-Mail, weil du ein Konto bei Tiza angelegt hast.', unsub: 'Abmelden' },
    page: { title: 'Du bekommst diese E-Mails nicht mehr', body: 'Dein Konto und dein Training bleiben genau so, wie sie sind.', again: 'Wieder anmelden', resubbed: 'Erledigt — du bekommst sie wieder.' }
  },
  fr: {
    welcome: { subject: 'Bienvenue sur Tiza', titleName: 'Bonjour {name} !', title: 'Bienvenue sur Tiza !', body: 'Ton programme est prêt. Un jour d’entraînement, ouvre l’app et touche Commencer : Tiza te guide série par série, calcule les charges et les augmente quand tu fais toutes les répétitions.', tip: 'Active les rappels et on te dira quand c’est l’heure de t’entraîner.', cta: 'Ouvrir Tiza' },
    day3: { subject: 'Ta première séance t’attend', title: 'Prêt pour ta première séance ?', body: 'Trois jours et pas encore de séance — c’est normal, la première est la plus dure à lancer. Ton programme est prêt : ouvre Tiza et touche Commencer. Si tu ne connais pas tes charges, Tiza les trouve avec toi pendant cette première séance.', cta: 'Commencer ma première séance' },
    week1: { subject: 'Ta première semaine avec Tiza', title: 'Ta première semaine', workouts: 'Séances', sets: 'Séries', volume: 'Volume', records: 'Records', body: 'Un bon début. Garde le même rythme la semaine prochaine : venir, c’est ce qui compte le plus.', title0: 'Ton programme t’attend toujours', body0: 'Pas de séance cette première semaine — ça arrive. Une courte séance suffit pour démarrer ; tes charges sont déjà calculées.', cta: 'Ouvrir Tiza' },
    footer: { why: 'Tu reçois cet e-mail parce que tu as créé un compte sur Tiza.', unsub: 'Se désabonner' },
    page: { title: 'Tu ne recevras plus ces e-mails', body: 'Ton compte et tes entraînements restent exactement comme ils sont.', again: 'Me réabonner', resubbed: 'C’est fait — tu les recevras à nouveau.' }
  },
  it: {
    welcome: { subject: 'Benvenuto in Tiza', titleName: 'Ciao {name}!', title: 'Benvenuto in Tiza!', body: 'Il tuo piano è pronto. Nel giorno di allenamento apri l’app e tocca Inizia: Tiza ti guida serie per serie, calcola i pesi e li aumenta quando completi tutte le ripetizioni.', tip: 'Attiva i promemoria e ti diremo quando è ora di allenarti.', cta: 'Apri Tiza' },
    day3: { subject: 'Il tuo primo allenamento ti aspetta', title: 'Pronto per la prima sessione?', body: 'Sono passati tre giorni e non ti sei ancora allenato: è normale, la prima sessione è la più difficile da iniziare. Il tuo piano è pronto: apri Tiza e tocca Inizia. Se non conosci i tuoi pesi, Tiza ti aiuta a trovarli in quella prima sessione.', cta: 'Inizia il primo allenamento' },
    week1: { subject: 'La tua prima settimana con Tiza', title: 'La tua prima settimana', workouts: 'Allenamenti', sets: 'Serie', volume: 'Volume', records: 'Record', body: 'Un buon inizio. Mantieni lo stesso ritmo la prossima settimana: esserci conta più di tutto.', title0: 'Il tuo piano ti aspetta ancora', body0: 'Nessun allenamento in questa prima settimana: succede. Basta una sessione breve per ripartire; i tuoi pesi sono già calcolati.', cta: 'Apri Tiza' },
    footer: { why: 'Ricevi questa email perché hai creato un account su Tiza.', unsub: 'Annulla l’iscrizione' },
    page: { title: 'Non riceverai più queste email', body: 'Il tuo account e i tuoi allenamenti restano esattamente come sono.', again: 'Iscrivimi di nuovo', resubbed: 'Fatto: le riceverai di nuovo.' }
  },
  pl: {
    welcome: { subject: 'Witaj w Tiza', titleName: 'Cześć, {name}!', title: 'Witaj w Tiza!', body: 'Twój plan jest gotowy. W dzień treningu otwórz aplikację i stuknij Start: Tiza prowadzi Cię seria po serii, wylicza ciężary i podnosi je, gdy zrobisz wszystkie powtórzenia.', tip: 'Włącz przypomnienia, a powiemy Ci, kiedy pora na trening.', cta: 'Otwórz Tiza' },
    day3: { subject: 'Twój pierwszy trening czeka', title: 'Gotowy na pierwszą sesję?', body: 'Minęły trzy dni, a treningu jeszcze nie było — to normalne, pierwszą sesję najtrudniej zacząć. Twój plan jest gotowy: otwórz Tiza i stuknij Start. Jeśli nie znasz swoich ciężarów, Tiza pomoże Ci je znaleźć w tej pierwszej sesji.', cta: 'Zacznij pierwszy trening' },
    week1: { subject: 'Twój pierwszy tydzień z Tiza', title: 'Twój pierwszy tydzień', workouts: 'Treningi', sets: 'Serie', volume: 'Objętość', records: 'Rekordy', body: 'Dobry początek. Utrzymaj ten rytm w przyszłym tygodniu: najważniejsze jest to, żeby się pojawiać.', title0: 'Twój plan wciąż czeka', body0: 'W tym pierwszym tygodniu nie było treningów — zdarza się. Wystarczy krótka sesja, żeby ruszyć; Twoje ciężary są już wyliczone.', cta: 'Otwórz Tiza' },
    footer: { why: 'Dostajesz tę wiadomość, bo założyłeś konto w Tiza.', unsub: 'Wypisz mnie' },
    page: { title: 'Nie będziesz już dostawać tych wiadomości', body: 'Twoje konto i treningi zostają dokładnie takie, jakie są.', again: 'Zapisz mnie ponownie', resubbed: 'Gotowe — znów będziesz je dostawać.' }
  },
  hu: {
    welcome: { subject: 'Üdv a Tizában', titleName: 'Szia, {name}!', title: 'Üdv a Tizában!', body: 'Kész a terved. Edzésnapon nyisd meg az appot, és koppints az Indításra: a Tiza sorozatról sorozatra végigvezet, kiszámolja a súlyokat, és emeli őket, ha minden ismétlést megcsinálsz.', tip: 'Kapcsold be az emlékeztetőket, és szólunk, ha itt az edzés ideje.', cta: 'Tiza megnyitása' },
    day3: { subject: 'Vár az első edzésed', title: 'Készen állsz az első edzésre?', body: 'Eltelt három nap, és még nem edzettél — ez természetes, az elsőt a legnehezebb elkezdeni. Kész a terved: nyisd meg a Tizát, és koppints az Indításra. Ha nem tudod a súlyaidat, a Tiza segít megtalálni őket az első edzésen.', cta: 'Első edzésem indítása' },
    week1: { subject: 'Az első heted a Tizával', title: 'Az első heted', workouts: 'Edzések', sets: 'Sorozatok', volume: 'Volumen', records: 'Rekordok', body: 'Jó kezdés. Tartsd a ritmust jövő héten is: a kitartás mindennél többet ér.', title0: 'A terved még mindig vár', body0: 'Ezen az első héten nem volt edzés — előfordul. Egy rövid edzés elég, hogy beindulj; a súlyaid már ki vannak számolva.', cta: 'Tiza megnyitása' },
    footer: { why: 'Azért kapod ezt a levelet, mert fiókot hoztál létre a Tizában.', unsub: 'Leiratkozás' },
    page: { title: 'Nem kapod többé ezeket a leveleket', body: 'A fiókod és az edzéseid pontosan úgy maradnak, ahogy vannak.', again: 'Újra feliratkozom', resubbed: 'Kész — újra megkapod őket.' }
  },
  ru: {
    welcome: { subject: 'Добро пожаловать в Tiza', titleName: 'Привет, {name}!', title: 'Добро пожаловать в Tiza!', body: 'Твой план готов. В день тренировки открой приложение и нажми «Начать»: Tiza проведёт тебя подход за подходом, рассчитает веса и поднимет их, когда ты выполнишь все повторения.', tip: 'Включи напоминания, и мы подскажем, когда пора тренироваться.', cta: 'Открыть Tiza' },
    day3: { subject: 'Твоя первая тренировка ждёт', title: 'Готов к первой тренировке?', body: 'Прошло три дня, а тренировки ещё не было — это нормально, первую начать труднее всего. Твой план готов: открой Tiza и нажми «Начать». Если не знаешь своих весов, Tiza поможет подобрать их на этой первой тренировке.', cta: 'Начать первую тренировку' },
    week1: { subject: 'Твоя первая неделя с Tiza', title: 'Твоя первая неделя', workouts: 'Тренировки', sets: 'Подходы', volume: 'Объём', records: 'Рекорды', body: 'Хорошее начало. Держи тот же ритм на следующей неделе: регулярность важнее всего.', title0: 'Твой план всё ещё ждёт', body0: 'На этой первой неделе тренировок не было — бывает. Достаточно короткой тренировки, чтобы начать; веса уже рассчитаны.', cta: 'Открыть Tiza' },
    footer: { why: 'Ты получаешь это письмо, потому что создал аккаунт в Tiza.', unsub: 'Отписаться' },
    page: { title: 'Эти письма больше не будут приходить', body: 'Аккаунт и тренировки остаются точно такими же.', again: 'Подписаться снова', resubbed: 'Готово — письма снова будут приходить.' }
  },
  uk: {
    welcome: { subject: 'Ласкаво просимо до Tiza', titleName: 'Привіт, {name}!', title: 'Ласкаво просимо до Tiza!', body: 'Твій план готовий. У день тренування відкрий застосунок і натисни «Почати»: Tiza проведе тебе підхід за підходом, розрахує ваги й підніме їх, коли ти виконаєш усі повторення.', tip: 'Увімкни нагадування, і ми підкажемо, коли час тренуватися.', cta: 'Відкрити Tiza' },
    day3: { subject: 'Твоє перше тренування чекає', title: 'Готовий до першого тренування?', body: 'Минуло три дні, а тренування ще не було — це нормально, перше почати найважче. Твій план готовий: відкрий Tiza й натисни «Почати». Якщо не знаєш своїх ваг, Tiza допоможе підібрати їх на цьому першому тренуванні.', cta: 'Почати перше тренування' },
    week1: { subject: 'Твій перший тиждень із Tiza', title: 'Твій перший тиждень', workouts: 'Тренування', sets: 'Підходи', volume: 'Обсяг', records: 'Рекорди', body: 'Гарний початок. Тримай той самий ритм наступного тижня: регулярність важливіша за все.', title0: 'Твій план досі чекає', body0: 'Цього першого тижня тренувань не було — буває. Достатньо короткого тренування, щоб почати; ваги вже розраховані.', cta: 'Відкрити Tiza' },
    footer: { why: 'Ти отримуєш цей лист, бо створив акаунт у Tiza.', unsub: 'Відписатися' },
    page: { title: 'Ці листи більше не надходитимуть', body: 'Акаунт і тренування залишаються точно такими ж.', again: 'Підписатися знову', resubbed: 'Готово — листи знову надходитимуть.' }
  },
  tr: {
    welcome: { subject: 'Tiza’ya hoş geldin', titleName: 'Merhaba {name}!', title: 'Tiza’ya hoş geldin!', body: 'Planın hazır. Antrenman gününde uygulamayı aç ve Başla’ya dokun: Tiza seni set set yönlendirir, ağırlıkları hesaplar ve tüm tekrarları tamamladığında artırır.', tip: 'Hatırlatıcıları aç, antrenman zamanı geldiğinde haber verelim.', cta: 'Tiza’yı aç' },
    day3: { subject: 'İlk antrenmanın seni bekliyor', title: 'İlk antrenmana hazır mısın?', body: 'Üç gün oldu ve henüz antrenman yapmadın — bu normal, ilkine başlamak en zoru. Planın hazır: Tiza’yı aç ve Başla’ya dokun. Ağırlıklarını bilmiyorsan Tiza o ilk antrenmanda onları seninle birlikte bulur.', cta: 'İlk antrenmanımı başlat' },
    week1: { subject: 'Tiza ile ilk haftan', title: 'İlk haftan', workouts: 'Antrenmanlar', sets: 'Setler', volume: 'Hacim', records: 'Rekorlar', body: 'İyi bir başlangıç. Gelecek hafta da aynı ritmi koru: düzenli gelmek her şeyden önemli.', title0: 'Planın hâlâ seni bekliyor', body0: 'Bu ilk hafta antrenman yok — olur böyle. Başlamak için kısa bir antrenman yeter; ağırlıkların zaten hesaplandı.', cta: 'Tiza’yı aç' },
    footer: { why: 'Bu e-postayı Tiza’da hesap oluşturduğun için alıyorsun.', unsub: 'Abonelikten çık' },
    page: { title: 'Bu e-postaları artık almayacaksın', body: 'Hesabın ve antrenmanların olduğu gibi kalıyor.', again: 'Yeniden abone ol', resubbed: 'Tamam — yeniden alacaksın.' }
  },
  ar: {
    welcome: { subject: 'مرحبًا بك في Tiza', titleName: 'مرحبًا يا {name}!', title: 'مرحبًا بك في Tiza!', body: 'خطتك جاهزة. في يوم التمرين افتح التطبيق واضغط ابدأ: يرشدك Tiza مجموعة بعد مجموعة، ويحسب الأوزان ويرفعها عندما تُكمل كل التكرارات.', tip: 'فعّل التذكيرات وسنخبرك عندما يحين وقت التمرين.', cta: 'افتح Tiza' },
    day3: { subject: 'تمرينك الأول بانتظارك', title: 'هل أنت مستعد لجلستك الأولى؟', body: 'مرّت ثلاثة أيام ولم تتمرن بعد — هذا طبيعي، فالجلسة الأولى هي الأصعب بدءًا. خطتك جاهزة: افتح Tiza واضغط ابدأ. وإن كنت لا تعرف أوزانك، يساعدك Tiza على إيجادها في تلك الجلسة الأولى.', cta: 'ابدأ تمريني الأول' },
    week1: { subject: 'أسبوعك الأول مع Tiza', title: 'أسبوعك الأول', workouts: 'التمارين', sets: 'المجموعات', volume: 'الحجم', records: 'الأرقام القياسية', body: 'بداية جيدة. حافظ على الإيقاع نفسه الأسبوع القادم: الالتزام أهم من أي شيء.', title0: 'خطتك لا تزال بانتظارك', body0: 'لم تكن هناك تمارين في هذا الأسبوع الأول — يحدث ذلك. تكفي جلسة قصيرة للانطلاق؛ أوزانك محسوبة بالفعل.', cta: 'افتح Tiza' },
    footer: { why: 'تصلك هذه الرسالة لأنك أنشأت حسابًا في Tiza.', unsub: 'إلغاء الاشتراك' },
    page: { title: 'لن تصلك هذه الرسائل بعد الآن', body: 'يبقى حسابك وتمارينك كما هي تمامًا.', again: 'الاشتراك مجددًا', resubbed: 'تم — ستصلك مجددًا.' }
  },
  hi: {
    welcome: { subject: 'Tiza में आपका स्वागत है', titleName: 'नमस्ते, {name}!', title: 'Tiza में आपका स्वागत है!', body: 'आपका प्लान तैयार है। ट्रेनिंग वाले दिन ऐप खोलें और शुरू करें पर टैप करें: Tiza आपको सेट-दर-सेट ले चलता है, वज़न तय करता है और सारे रेप्स पूरे होने पर उन्हें बढ़ाता है।', tip: 'रिमाइंडर चालू करें, हम बताएँगे कि ट्रेनिंग का समय कब है।', cta: 'Tiza खोलें' },
    day3: { subject: 'आपका पहला वर्कआउट इंतज़ार कर रहा है', title: 'पहले सेशन के लिए तैयार?', body: 'तीन दिन हो गए और अभी तक वर्कआउट नहीं हुआ — यह आम बात है, पहला सेशन शुरू करना सबसे मुश्किल होता है। आपका प्लान तैयार है: Tiza खोलें और शुरू करें पर टैप करें। अगर आपको अपने वज़न नहीं पता, तो Tiza उसी पहले सेशन में उन्हें ढूँढने में मदद करता है।', cta: 'मेरा पहला वर्कआउट शुरू करें' },
    week1: { subject: 'Tiza के साथ आपका पहला हफ़्ता', title: 'आपका पहला हफ़्ता', workouts: 'वर्कआउट', sets: 'सेट', volume: 'वॉल्यूम', records: 'रिकॉर्ड', body: 'अच्छी शुरुआत। अगले हफ़्ते भी यही रफ़्तार रखें: लगातार आना सबसे ज़रूरी है।', title0: 'आपका प्लान अब भी इंतज़ार कर रहा है', body0: 'इस पहले हफ़्ते कोई वर्कआउट नहीं हुआ — ऐसा होता है। शुरू करने के लिए एक छोटा सेशन काफ़ी है; आपके वज़न पहले से तय हैं।', cta: 'Tiza खोलें' },
    footer: { why: 'आपको यह ईमेल इसलिए मिला क्योंकि आपने Tiza पर खाता बनाया है।', unsub: 'सदस्यता छोड़ें' },
    page: { title: 'अब आपको ये ईमेल नहीं मिलेंगे', body: 'आपका खाता और आपकी ट्रेनिंग जैसी हैं वैसी ही रहेंगी।', again: 'फिर से सदस्यता लें', resubbed: 'हो गया — आपको ये फिर मिलेंगे।' }
  },
  ko: {
    welcome: { subject: 'Tiza에 오신 것을 환영해요', titleName: '{name}님, 안녕하세요!', title: 'Tiza에 오신 것을 환영해요!', body: '플랜이 준비됐어요. 운동하는 날 앱을 열고 시작을 누르세요. Tiza가 세트마다 안내하고, 무게를 계산하고, 모든 반복을 완료하면 무게를 올려 줘요.', tip: '알림을 켜면 운동할 시간이 되었을 때 알려 드릴게요.', cta: 'Tiza 열기' },
    day3: { subject: '첫 운동이 기다리고 있어요', title: '첫 세션을 시작할 준비가 됐나요?', body: '가입한 지 3일이 지났는데 아직 운동하지 않았어요. 괜찮아요, 첫 세션이 시작하기 가장 어려워요. 플랜은 준비돼 있어요. Tiza를 열고 시작을 누르세요. 무게를 모르면 첫 세션에서 Tiza가 함께 찾아 줘요.', cta: '첫 운동 시작하기' },
    week1: { subject: 'Tiza와 함께한 첫 주', title: '첫 주', workouts: '운동', sets: '세트', volume: '볼륨', records: '기록', body: '좋은 출발이에요. 다음 주에도 같은 리듬을 유지하세요. 꾸준히 나오는 것이 가장 중요해요.', title0: '플랜이 아직 기다리고 있어요', body0: '첫 주에는 운동이 없었어요. 그럴 수 있어요. 짧은 세션 하나면 다시 시작할 수 있어요. 무게는 이미 계산돼 있어요.', cta: 'Tiza 열기' },
    footer: { why: 'Tiza에 계정을 만드셨기 때문에 이 이메일을 받으셨어요.', unsub: '수신 거부' },
    page: { title: '더 이상 이 이메일을 받지 않아요', body: '계정과 운동 기록은 그대로 유지돼요.', again: '다시 구독하기', resubbed: '완료 — 다시 받게 돼요.' }
  },
  th: {
    welcome: { subject: 'ยินดีต้อนรับสู่ Tiza', titleName: 'สวัสดี {name}!', title: 'ยินดีต้อนรับสู่ Tiza!', body: 'แผนของคุณพร้อมแล้ว ในวันฝึก เปิดแอปแล้วแตะเริ่ม Tiza จะพาคุณไปทีละเซ็ต คำนวณน้ำหนัก และเพิ่มให้เมื่อคุณทำครบทุกครั้ง', tip: 'เปิดการแจ้งเตือน แล้วเราจะบอกเมื่อถึงเวลาฝึก', cta: 'เปิด Tiza' },
    day3: { subject: 'การฝึกครั้งแรกของคุณรออยู่', title: 'พร้อมสำหรับการฝึกครั้งแรกไหม?', body: 'ผ่านไปสามวันแล้วและยังไม่ได้ฝึก ไม่เป็นไร ครั้งแรกเริ่มยากที่สุด แผนของคุณพร้อมแล้ว เปิด Tiza แล้วแตะเริ่ม ถ้าไม่รู้น้ำหนักของตัวเอง Tiza จะช่วยหาในการฝึกครั้งแรกนั้น', cta: 'เริ่มการฝึกครั้งแรก' },
    week1: { subject: 'สัปดาห์แรกของคุณกับ Tiza', title: 'สัปดาห์แรกของคุณ', workouts: 'การฝึก', sets: 'เซ็ต', volume: 'ปริมาณ', records: 'สถิติ', body: 'เริ่มต้นได้ดี รักษาจังหวะเดิมในสัปดาห์หน้า การมาอย่างสม่ำเสมอสำคัญที่สุด', title0: 'แผนของคุณยังรออยู่', body0: 'สัปดาห์แรกนี้ยังไม่มีการฝึก เกิดขึ้นได้ แค่ฝึกสั้น ๆ หนึ่งครั้งก็เริ่มได้แล้ว น้ำหนักของคุณคำนวณไว้แล้ว', cta: 'เปิด Tiza' },
    footer: { why: 'คุณได้รับอีเมลนี้เพราะคุณสร้างบัญชีใน Tiza', unsub: 'ยกเลิกการรับอีเมล' },
    page: { title: 'คุณจะไม่ได้รับอีเมลเหล่านี้อีก', body: 'บัญชีและการฝึกของคุณยังคงเหมือนเดิมทุกอย่าง', again: 'สมัครรับอีกครั้ง', resubbed: 'เรียบร้อย — คุณจะได้รับอีกครั้ง' }
  },
  zh: {
    welcome: { subject: '欢迎使用 Tiza', titleName: '{name}，你好！', title: '欢迎使用 Tiza！', body: '你的计划已经准备好了。训练日打开应用，点“开始”：Tiza 会一组一组地带你练，算好重量，并在你完成所有次数后为你加重。', tip: '打开提醒，到训练时间我们会告诉你。', cta: '打开 Tiza' },
    day3: { subject: '你的第一次训练在等你', title: '准备好第一次训练了吗？', body: '注册三天了还没训练——这很正常，第一次最难开始。你的计划已经准备好：打开 Tiza，点“开始”。如果不知道自己的重量，Tiza 会在第一次训练中帮你找到。', cta: '开始第一次训练' },
    week1: { subject: '你和 Tiza 的第一周', title: '你的第一周', workouts: '训练', sets: '组数', volume: '训练量', records: '纪录', body: '开局不错。下周保持同样的节奏：坚持出现比什么都重要。', title0: '你的计划还在等你', body0: '这第一周没有训练——这很常见。一次简短的训练就能重新开始；你的重量已经算好了。', cta: '打开 Tiza' },
    footer: { why: '你收到这封邮件，是因为你在 Tiza 创建了账户。', unsub: '退订' },
    page: { title: '你将不再收到这些邮件', body: '你的账户和训练记录保持不变。', again: '重新订阅', resubbed: '完成——你会再次收到。' }
  }
};
