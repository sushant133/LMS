import { Link } from "react-router-dom";
import { CollegeLogo } from "components/shared/CollegeLogo";
import { Button } from "components/ui/button";

export const NotFoundPage = () => (
  <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 px-6 text-center text-white">
    <CollegeLogo className="h-14 w-14" />
    <p className="text-sm uppercase tracking-[0.3em] text-brand-300">404</p>
    <h1 className="text-4xl font-semibold">Page not found</h1>
    <p className="max-w-md text-slate-300">The page you requested does not exist in the PHIT LMS workspace.</p>
    <Button asChild>
      <Link to="/">Go home</Link>
    </Button>
  </div>
);
