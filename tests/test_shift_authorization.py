"""Real Flask/Login/SQLAlchemy tests with an isolated SQLite database.

Load production models and routes without running the production app factory.
Only Socket.IO is mocked; no mail, server config or production DB is loaded.
"""
import sys
import types
import unittest
from pathlib import Path
from datetime import date, datetime, timedelta
from unittest.mock import Mock, patch
from flask import Flask
from flask_login import LoginManager
from flask_sqlalchemy import SQLAlchemy

root = Path(__file__).resolve().parents[1]
pkg = types.ModuleType('dhf_app')
pkg.__path__ = [str(root / 'dhf_app')]
sys.modules['dhf_app'] = pkg
ext = types.ModuleType('dhf_app.extensions')
ext.db = db = SQLAlchemy()
ext.socketio = Mock()
sys.modules[ext.__name__] = ext
from dhf_app.models import User, Role, Shift, ShiftType
import dhf_app.models_dogs
from dhf_app.models_market import ShiftMarketOffer, ShiftMarketResponse
from dhf_app.models_shift_change import ShiftChangeRequest
from dhf_app.services_shift_change import ShiftChangeService
from dhf_app.services_market import MarketService
from dhf_app.routes.shift_change_routes import shift_change_bp
from dhf_app.routes_market import market_bp


class AuthorizationTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(TESTING=True, SECRET_KEY='test-only',
                               SQLALCHEMY_DATABASE_URI='sqlite://')
        db.init_app(self.app)
        lm = LoginManager(self.app)
        lm.user_loader(lambda uid: db.session.get(User, int(uid)))
        self.app.register_blueprint(shift_change_bp, url_prefix='/api/shift-change')
        self.app.register_blueprint(market_bp)
        self.ctx = self.app.app_context()
        self.ctx.push()
        db.create_all()
        self.users = {}
        for i, role in enumerate(['Hundeführer', 'admin', 'Planschreiber', 'Besucher', None], 1):
            r = Role(name=role) if role else None
            u = User(id=i, vorname='Test', name=str(i), passwort_hash='unused', role=r)
            db.session.add(u)
            self.users[role] = i
        db.session.add(User(id=6, vorname='Ersatz', name='Test', passwort_hash='unused',
                            role=db.session.get(User, 1).role))
        db.session.add_all([ShiftType(id=1, name='Tag', abbreviation='T.'),
                            ShiftType(id=2, name='Krank', abbreviation='K')])
        db.session.add(Shift(id=1, user_id=1, shifttype_id=1, date=date(2026, 12, 1), is_locked=True))
        db.session.commit()
        self.client = self.app.test_client()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        self.ctx.pop()

    def login(self, uid):
        with self.client.session_transaction() as s:
            s['_user_id'] = str(uid)
            s['_fresh'] = True

    def request(self, **extra):
        return self.client.post('/api/shift-change/request', json={'shift_id': 1, **extra})

    def offer(self, interested=True):
        o = ShiftMarketOffer(id=1, shift_id=1, offering_user_id=1,
                             auto_accept_deadline=datetime.utcnow() - timedelta(minutes=1))
        db.session.add(o)
        if interested:
            db.session.add(ShiftMarketResponse(offer_id=1, user_id=6, response_type='interested'))
        db.session.commit()
        return o

    def test_login_required(self):
        self.assertEqual(self.request().status_code, 401)

    def test_direct_trade_denied_for_every_role(self):
        for uid in range(1, 7):
            self.login(uid)
            self.assertEqual(self.request(reason_type='trade', replacement_user_id=6).status_code, 403)
        self.assertEqual(ShiftChangeRequest.query.count(), 0)
        self.assertEqual(db.session.get(Shift, 1).shifttype_id, 1)

    def test_own_sickness_pending(self):
        self.login(1)
        self.assertEqual(self.request().status_code, 201)
        self.assertEqual(ShiftChangeRequest.query.one().status, 'pending')

    def test_foreign_sickness_denied(self):
        for uid in [4, 5, 6]:
            self.login(uid)
            self.assertEqual(self.request().status_code, 403)
        self.assertEqual(ShiftChangeRequest.query.count(), 0)

    def test_admin_and_scheduler_sickness(self):
        for uid in [2, 3]:
            self.login(uid)
            self.assertEqual(self.request(replacement_user_id=6).status_code, 200)
            self.assertEqual(db.session.get(Shift, 1).shifttype_id, 2)

    def test_invalid_replacement_denied(self):
        self.login(2)
        for uid in [1, 999]:
            self.assertEqual(self.request(replacement_user_id=uid).status_code, 400)
        self.assertEqual(ShiftChangeRequest.query.count(), 0)

    def test_no_consent_rolls_back_selection(self):
        self.offer(False)
        self.login(1)
        r = self.client.post('/api/market/offer/1/select_candidate', json={'candidate_id': 6})
        self.assertEqual(r.status_code, 409)
        db.session.expire_all()
        self.assertEqual(db.session.get(ShiftMarketOffer, 1).status, 'active')
        self.assertEqual(ShiftChangeRequest.query.count(), 0)
        self.assertIsNotNone(db.session.get(Shift, 1))

    def test_manual_market_success(self):
        self.offer()
        self.login(1)
        r = self.client.post('/api/market/offer/1/select_candidate', json={'candidate_id': 6})
        self.assertEqual(r.status_code, 200, r.json)
        self.assertEqual(Shift.query.one().user_id, 6)
        self.assertEqual(ShiftChangeRequest.query.one().status, 'approved')

    def test_auto_market_success(self):
        self.offer()
        MarketService.process_auto_accepts()
        self.assertEqual(Shift.query.one().user_id, 6)
        self.assertEqual(ShiftChangeRequest.query.one().status, 'approved')

    def test_service_rejects_trade_without_offer(self):
        res, code = ShiftChangeService.create_request(1, 1, 6, reason_type='trade')
        self.assertEqual(code, 403)
        self.assertEqual(ShiftChangeRequest.query.count(), 0)

    def test_old_unconfirmed_trade_cannot_be_approved(self):
        db.session.add(ShiftChangeRequest(original_shift_id=1, requester_id=1,
                                         reason_type='trade', status='pending'))
        db.session.commit()
        self.login(2)
        r = self.client.post('/api/shift-change/1/approve')
        self.assertEqual(r.status_code, 403)
        self.assertIsNotNone(db.session.get(Shift, 1))

    def test_invalid_payload(self):
        self.login(2)
        self.assertEqual(self.client.post('/api/shift-change/request', json=[]).status_code, 400)

    def test_failed_approval_rolls_back_new_request(self):
        self.offer()
        self.login(1)
        with patch.object(ShiftChangeService, 'approve_request', return_value=({'error': 'test'}, 409)):
            r = self.client.post('/api/market/offer/1/select_candidate', json={'candidate_id': 6})
        self.assertEqual(r.status_code, 409)
        db.session.expire_all()
        self.assertEqual(ShiftChangeRequest.query.count(), 0)
        self.assertEqual(db.session.get(ShiftMarketOffer, 1).status, 'active')
        self.assertIsNotNone(db.session.get(Shift, 1))

    def test_auto_rejects_candidate_with_removed_role(self):
        self.offer()
        db.session.get(User, 6).role = None
        db.session.commit()
        MarketService.process_auto_accepts()
        db.session.expire_all()
        self.assertEqual(db.session.get(ShiftMarketOffer, 1).status, 'active')
        self.assertEqual(ShiftChangeRequest.query.count(), 0)
        self.assertEqual(Shift.query.one().user_id, 1)

    def test_foreign_offer_selection_denied(self):
        self.offer()
        for uid in [2, 3, 4, 5, 6]:
            self.login(uid)
            r = self.client.post('/api/market/offer/1/select_candidate', json={'candidate_id': 6})
            self.assertEqual(r.status_code, 403)
        self.assertEqual(ShiftChangeRequest.query.count(), 0)

    def test_unknown_reason_rejected_in_service(self):
        self.assertEqual(ShiftChangeService.create_request(1, 1, reason_type='other')[1], 400)

    def test_wrong_offer_rejected_in_service(self):
        offer = self.offer()
        offer.status = 'pending'
        offer.accepted_by_id = 6
        offer.offering_user_id = 2
        db.session.commit()
        self.assertEqual(ShiftChangeService.create_request(1, 1, 6, reason_type='trade', market_offer_id=1)[1], 409)
        self.assertEqual(ShiftChangeRequest.query.count(), 0)

    def test_roleless_moderation_denied(self):
        self.login(5)
        self.assertEqual(self.client.post('/api/shift-change/1/approve').status_code, 403)
        self.assertEqual(self.client.post('/api/shift-change/1/reject').status_code, 403)
        self.assertEqual(self.client.delete('/api/shift-change/1').status_code, 403)


if __name__ == '__main__':
    unittest.main()
