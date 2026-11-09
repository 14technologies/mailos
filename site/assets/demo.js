/* v2.49 Live MailOS demo (template-parts/mailos-demo.php). No network, no storage: everything is local. */
(function () {
	var COLORS = ['#f9a8d4', '#93c5fd', '#fcd34d', '#a7f3d0', '#c4b5fd', '#fdba74'];
	var BOXES = ['info@yourcompany.com', 'sales@yourcompany.com', 'support@yourcompany.com'];
	var SEED = {
		'info@yourcompany.com': [
			{ from: 'Ayesha Khan', subj: 'New website and email for our clinic', body: 'Hi team,\n\nWe are opening a second branch next month and need professional email for 8 doctors and the front desk.\n\nCan you help us set up MailOS?\n\nThanks,\nAyesha', time: '9:41', unread: true, folder: 'inbox' },
			{ from: 'Bank Alfalah', subj: 'Payment received: Rs 49,999', body: 'Dear customer,\n\nWe have received your payment of Rs 49,999 for invoice #1042.\n\nThis is an automated message.', time: '9:12', folder: 'inbox' },
			{ from: 'Hamza Ali', subj: 'Meeting at 3pm today?', body: 'Hi,\n\nAre we still on for 3pm? I will bring the signed agreement.\n\nHamza', time: '8:55', unread: true, folder: 'inbox', star: true },
			{ from: 'Google Workspace', subj: 'Your invoice: $84 for 12 users', body: 'This month: 12 users × $7 = $84.\n\nWith MailOS you would pay for the plan, not for every inbox.', time: 'Mon', folder: 'inbox' },
			{ from: 'You', to: 'Sara Ahmed', subj: 'Welcome to 14 Technologies', body: 'Hi Sara,\n\nWelcome aboard! Your new address sara@yourcompany.com is ready.', time: 'Mon', folder: 'sent', self: true },
		],
		'sales@yourcompany.com': [
			{ from: 'Bilal Traders', subj: 'Order of 200 units: quotation please', body: 'Assalam o Alaikum,\n\nPlease send a quotation for 200 units with delivery to Lahore.\n\nBilal', time: '10:20', unread: true, folder: 'inbox' },
			{ from: 'Zara Malik', subj: 'Re: Annual plan discount', body: 'Thanks! The 50% offer works for us. Please send the invoice.', time: '9:03', folder: 'inbox', star: true },
		],
		'support@yourcompany.com': [
			{ from: 'Usman Riaz', subj: 'Cannot log in on my phone', body: 'Hi support,\n\nI installed the app on my iPhone but notifications are not showing.\n\nUsman', time: '11:02', unread: true, folder: 'inbox' },
		],
	};
	var DRAFT = 'Hi Ayesha,\n\nThank you for your time today. Please find our quotation for the website, booking system and business email for your team.\n\nWe can start next Monday.\n\nBest regards,\nSales team';
	var TICK = '<svg class="mx-tick" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
	var STAR = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9z"/></svg>';
	var BACK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18 9 12l6-6"/></svg>';

	function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
	function reduced() { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; }

	function init(root) {
		var q = function (s) { return root.querySelector(s); };
		var data = JSON.parse(JSON.stringify(SEED));
		var box = BOXES[0], folder = 'inbox', open = null, term = '';
		var org = root.getAttribute('data-mx-org');
		var list = q('[data-mx-list]'), read = q('[data-mx-read]'), toast = q('[data-mx-toast]');

		function avatar(m) {
			if (m.self) return '<span class="mx-av"><img src="' + org + '" alt=""></span>';
			var c = COLORS[(m.from.charCodeAt(0) + m.from.length) % COLORS.length];
			return '<span class="mx-av" style="background:' + c + '">' + esc(m.from.charAt(0)) + '</span>';
		}
		function items() {
			return data[box].filter(function (m) {
				var inFolder = folder === 'starred' ? m.star : m.folder === folder;
				return inFolder && (!term || (m.from + ' ' + m.subj + ' ' + m.body).toLowerCase().indexOf(term) >= 0);
			});
		}
		function count() {
			var n = data[box].filter(function (m) { return m.folder === 'inbox' && m.unread; }).length;
			var el = q('[data-mx-count]'); el.textContent = n || '';
		}
		function render() {
			var rows = items();
			list.innerHTML = rows.length ? rows.map(function (m, k) {
				return '<li class="mx-row' + (m.unread ? ' is-unread' : '') + (m === open ? ' is-on' : '') + '" data-k="' + data[box].indexOf(m) + '" tabindex="0" style="animation-delay:' + (k * 40) + 'ms">' + avatar(m) +
					'<span class="mx-meta"><span class="mx-from">' + esc(m.self ? 'To: ' + m.to : m.from) + '</span><span class="mx-subj">' + esc(m.subj) + '</span></span>' +
					'<span class="mx-side-r"><span>' + esc(m.time) + '</span><button type="button" class="mx-star' + (m.star ? ' is-on' : '') + '" data-star aria-label="Star">' + STAR + '</button></span></li>';
			}).join('') : '<li class="mx-empty">' + (term ? 'No emails match “' + esc(term) + '”' : 'Nothing here yet') + '</li>';
			count();
		}
		function show(m) {
			open = m; m.unread = false;
			read.innerHTML = '<button type="button" class="mx-back" data-back>' + BACK + 'Back</button><h3>' + esc(m.subj) + '</h3>' +
				'<div class="mx-read__who">' + avatar(m) + '<span><b>' + esc(m.self ? 'You' : m.from) + '</b><small>' + (m.self ? 'to ' + esc(m.to) : 'to ' + esc(box)) + ' · ' + esc(m.time) + '</small></span></div>' +
				'<div class="mx-read__body">' + esc(m.body) + '</div><button type="button" class="mx-reply" data-reply>Reply</button>';
			root.classList.add('is-reading'); render();
		}
		function say(text) {
			toast.textContent = text; toast.classList.add('is-on');
			clearTimeout(say.t); say.t = setTimeout(function () { toast.classList.remove('is-on'); }, 2200);
		}

		list.addEventListener('click', function (e) {
			var row = e.target.closest('.mx-row'); if (!row) return;
			var m = data[box][+row.getAttribute('data-k')];
			if (e.target.closest('[data-star]')) { m.star = !m.star; render(); return; }
			show(m);
		});
		list.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.classList.contains('mx-row')) e.target.click(); });
		read.addEventListener('click', function (e) {
			if (e.target.closest('[data-back]')) { root.classList.remove('is-reading'); open = null; render(); }
			if (e.target.closest('[data-reply]')) compose();
		});
		root.querySelectorAll('[data-mx-folder]').forEach(function (b) {
			b.addEventListener('click', function () {
				folder = b.getAttribute('data-mx-folder');
				root.querySelectorAll('[data-mx-folder]').forEach(function (x) { x.classList.toggle('is-on', x === b); });
				open = null; root.classList.remove('is-reading', 'is-menu');
				read.innerHTML = '<div class="mx-read__empty">Select an email to read it</div>'; render();
			});
		});
		q('[data-mx-search]').addEventListener('input', function (e) { term = e.target.value.trim().toLowerCase(); render(); });
		q('[data-mx-box]').addEventListener('click', function () {
			box = BOXES[(BOXES.indexOf(box) + 1) % BOXES.length];
			q('[data-mx-boxname]').textContent = box; open = null; root.classList.remove('is-reading');
			read.innerHTML = '<div class="mx-read__empty">Select an email to read it</div>'; render(); say('Switched to ' + box);
		});
		q('[data-mx-burger]').addEventListener('click', function () { root.classList.add('is-menu'); });
		q('[data-mx-scrim]').addEventListener('click', function () { root.classList.remove('is-menu'); });

		/* Compose: the email types itself, then Send turns into a tick. */
		var composer = q('[data-mx-composer]'), text = q('[data-mx-text]'), send = q('[data-mx-send]'), typing;
		function compose() {
			root.classList.remove('is-menu');
			composer.classList.add('is-open'); composer.classList.remove('is-done'); composer.setAttribute('aria-hidden', 'false');
			send.disabled = false; send.innerHTML = '<span>Send</span>';
			clearInterval(typing); text.textContent = '';
			if (reduced()) { text.textContent = DRAFT; composer.classList.add('is-done'); return; }
			var n = 0; typing = setInterval(function () {
				n += 3; text.textContent = DRAFT.slice(0, n);
				if (n >= DRAFT.length) { clearInterval(typing); composer.classList.add('is-done'); }
			}, 28);
		}
		function closeComposer() { clearInterval(typing); composer.classList.remove('is-open'); composer.setAttribute('aria-hidden', 'true'); }
		q('[data-mx-compose]').addEventListener('click', compose);
		q('[data-mx-close]').addEventListener('click', closeComposer);
		send.addEventListener('click', function () {
			clearInterval(typing); text.textContent = DRAFT; composer.classList.add('is-done');
			send.disabled = true; send.innerHTML = '<span class="mx-spin"></span>';
			setTimeout(function () {
				send.innerHTML = TICK;
				data[box].unshift({ from: 'You', to: 'Ayesha Khan', subj: q('[data-mx-subj]').textContent, body: DRAFT, time: 'Now', folder: 'sent', self: true });
				setTimeout(function () { closeComposer(); say('Sent ✓'); render(); }, 650);
			}, 500);
		});

		/* Accent colours recolour the whole demo. */
		root.querySelectorAll('[data-mx-accent]').forEach(function (b) {
			b.addEventListener('click', function () {
				root.setAttribute('data-accent', b.getAttribute('data-mx-accent'));
				root.querySelectorAll('[data-mx-accent]').forEach(function (x) { x.setAttribute('aria-checked', x === b ? 'true' : 'false'); });
			});
		});

		/* A new email arrives live once the demo is on screen. */
		var arrived = false;
		function arrive() {
			if (arrived) return; arrived = true;
			setTimeout(function () {
				data['info@yourcompany.com'].unshift({ from: 'Fatima Noor', subj: 'Can we start this week?', body: 'Hi,\n\nWe loved the demo. Can your team set up MailOS for our 25 staff this week?\n\nFatima', time: 'Now', unread: true, folder: 'inbox' });
				if (box === 'info@yourcompany.com') render();
				say('New email from Fatima Noor');
			}, 3500);
		}
		if ('IntersectionObserver' in window) {
			var io = new IntersectionObserver(function (es) { es.forEach(function (en) { if (en.isIntersecting) { arrive(); io.disconnect(); } }); }, { threshold: 0.4 });
			io.observe(root);
		} else arrive();

		render();
		if (!root.classList.contains('mx--compact') && window.matchMedia && !matchMedia('(max-width: 760px)').matches) show(data[box][0]);
	}

	function boot() { document.querySelectorAll('[data-mx]').forEach(init); }
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
