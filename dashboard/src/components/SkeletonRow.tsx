'use client';

import React from 'react';

interface SkeletonRowProps {
  count?: number;
}

export default function SkeletonRow({ count = 5 }: SkeletonRowProps) {
  return (
    <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl overflow-hidden shadow-xl animate-pulse">
      <div className="border-b border-[#1a1a1a] bg-[#141414] h-10 px-4 flex items-center justify-between">
        <div className="h-3 w-20 bg-[#1a1a1a] rounded"></div>
        <div className="h-3 w-16 bg-[#1a1a1a] rounded"></div>
        <div className="h-3 w-12 bg-[#1a1a1a] rounded"></div>
        <div className="h-3 w-16 bg-[#1a1a1a] rounded"></div>
      </div>
      <div className="divide-y divide-[#1a1a1a]">
        {Array.from({ length: count }).map((_, idx) => (
          <div key={idx} className="p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="h-4 w-24 bg-[#141414] border border-[#1a1a1a] rounded"></div>
              <div className="h-3 w-3 bg-[#141414] rounded"></div>
            </div>

            <div className="flex gap-1">
              <div className="h-5 w-16 bg-[#141414] border border-[#1a1a1a] rounded-md"></div>
              <div className="h-5 w-20 bg-[#141414] border border-[#1a1a1a] rounded-md"></div>
            </div>

            <div className="h-4 w-12 bg-[#141414] rounded"></div>
            <div className="h-4 w-16 bg-[#141414] rounded"></div>
            <div className="h-4 w-14 bg-[#141414] rounded"></div>

            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-[#141414]"></div>
              <div className="h-4 w-12 bg-[#141414] rounded"></div>
            </div>

            <div className="h-4 w-16 bg-[#141414] rounded"></div>
          </div>
        ))}
      </div>
    </div>
  );
}
