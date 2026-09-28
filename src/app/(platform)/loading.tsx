import { LoadingState } from "@/components/states/loading-state";

export default function PlatformLoading() {
  return (
    <div className="mx-auto w-full max-w-[var(--content-max-width)] px-4 py-8 md:px-8 lg:py-10">
      <LoadingState />
    </div>
  );
}
