import { Navigate, useLocation } from 'react-router';
import type { NavigationContext } from '@pengzhuang/client-model';
import { LoginPage, RegisterPage, RequestEmailPage, EmailLinkPage } from './access-pages';
import { AccountHub, DeletionRecoveryPage } from './profile-page';

export default function AccountRoutes({ context }: { context: NavigationContext }) {
  const { pathname } = useLocation();
  switch (pathname) {
    case '/login':
      return <LoginPage context={context} />;
    case '/profile':
      return <AccountHub />;
    case '/account/register':
      return <RegisterPage />;
    case '/account/forgot':
      return <RequestEmailPage key="reset-request" reset />;
    case '/account/resend':
      return <RequestEmailPage key="verify-request" reset={false} />;
    case '/account/verify':
      return <EmailLinkPage key="verify" kind="verify" />;
    case '/account/reset':
      return <EmailLinkPage key="reset" kind="reset" />;
    case '/account/link':
      return <EmailLinkPage key="link" kind="link" />;
    case '/account/deletion':
      return <DeletionRecoveryPage />;
    default:
      return <Navigate to="/login" replace />;
  }
}
