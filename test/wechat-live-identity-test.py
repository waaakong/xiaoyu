import importlib.util
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('setup',ROOT/'scripts/wechat-reader-setup.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class IdentityTests(unittest.TestCase):
    def test_one_verified_account_and_empty_launcher(self):
        active={'clientPid':10,'accountDirectories':['wxid_role_17fa'],'databaseHandleCount':104}
        self.assertEqual(m.select_live_identity([{'clientPid':11,'accountDirectories':[],'databaseHandleCount':0},active]),active)
    def test_multiple_accounts_or_missing_proof_are_rejected(self):
        active={'clientPid':10,'accountDirectories':['wxid_role_17fa'],'databaseHandleCount':1}
        for rows in [[],[{}],[{'accountDirectories':[],'databaseHandleCount':0}],[active,active],[{'accountDirectories':['a','b'],'databaseHandleCount':2}],[{'accountDirectories':['a'],'databaseHandleCount':0}]]:
            with self.subTest(rows=rows),self.assertRaises(ValueError):m.select_live_identity(rows)
if __name__=='__main__':unittest.main()
